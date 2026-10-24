import AppKit
import IOKit.pwr_mgt
import ServiceManagement
import UserNotifications

let repo = Bundle.main.bundleURL.resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent().path
let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agentview/logs")
let token = UUID().uuidString

final class Child {
  let name: String
  let command: String
  let env: [String: String]
  var pid: pid_t = 0
  var started = Date()
  var delay = 1.0
  var stopping = false
  var source: DispatchSourceProcess?

  init(_ name: String, _ command: String, env: [String: String] = [:]) {
    self.name = name
    self.command = command
    self.env = env
  }

  func start() {
    stopping = false
    let path = logs.appendingPathComponent("\(name).log").path
    let fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0o600)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
    posix_spawnattr_setpgroup(&attr, 0)
    var files: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&files)
    posix_spawn_file_actions_addopen(&files, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_adddup2(&files, fd, 1)
    posix_spawn_file_actions_adddup2(&files, fd, 2)
    posix_spawn_file_actions_addchdir_np(&files, repo)
    let merged = ProcessInfo.processInfo.environment.merging(env) { $1 }
    let cstr = { (s: String) -> UnsafeMutablePointer<CChar>? in s.withCString { strdup($0) } }
    let argv = ["/bin/zsh", "-ilc", "exec \(command)"].map(cstr) + [nil]
    let envp = merged.map { cstr("\($0)=\($1)") } + [nil]
    started = Date()
    let rc = posix_spawn(&pid, "/bin/zsh", &files, &attr, argv, envp)
    argv.forEach { free($0) }
    envp.forEach { free($0) }
    posix_spawn_file_actions_destroy(&files)
    posix_spawnattr_destroy(&attr)
    close(fd)
    if rc != 0 { pid = 0; return again() }
    let s = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    s.setEventHandler { [weak self] in self?.exited() }
    s.resume()
    source = s
  }

  func exited() {
    var status: Int32 = 0
    waitpid(pid, &status, 0)
    source?.cancel()
    source = nil
    pid = 0
    if !stopping { again() }
  }

  func again() {
    delay = Date().timeIntervalSince(started) > 30 ? 1 : min(delay * 2, 30)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, !self.stopping, self.pid == 0 else { return }
      self.start()
    }
  }

  func stop() {
    stopping = true
    guard pid > 0 else { return }
    kill(-pid, SIGTERM)
    let p = pid
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in if self?.pid == p { kill(-p, SIGKILL) } }
  }

  func restart() {
    guard pid > 0 else { return start() }
    stopping = false
    kill(-pid, SIGTERM)
  }
}

func output(_ tool: String, _ args: [String]) -> String {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: tool)
  p.arguments = args
  let out = Pipe()
  p.standardOutput = out
  try? p.run()
  p.waitUntilExit()
  return String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
}

// Stops earlier AgentView processes on our ports, and nothing else (another repo's vite also likes 5173).
// The server runs as `bun src/index.ts`, so its working directory names the repo, not its command.
func freePorts(_ ports: [Int]) {
  for port in ports {
    let pids = output("/usr/sbin/lsof", ["-ti", "tcp:\(port)", "-sTCP:LISTEN"]).split(separator: "\n").compactMap { pid_t($0) }
    for pid in pids where (output("/bin/ps", ["-o", "command=", "-p", "\(pid)"]) + output("/usr/sbin/lsof", ["-a", "-p", "\(pid)", "-d", "cwd", "-Fn"])).contains(repo) { kill(pid, SIGTERM) }
  }
}

final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  let path = logs.deletingLastPathComponent().appendingPathComponent("notify.fifo").path
  var buffer = Data()
  var onClick: () -> Void = {}

  func start() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    unlink(path)
    mkfifo(path, 0o600)
    let fd = open(path, O_RDWR)
    guard fd >= 0 else { return }
    FileHandle(fileDescriptor: fd).readabilityHandler = { [weak self] h in
      let d = h.availableData
      DispatchQueue.main.async { self?.received(d) }
    }
  }

  func received(_ d: Data) {
    buffer.append(d)
    while let i = buffer.firstIndex(of: 10) {
      let line = Data(buffer[..<i])
      buffer = Data(buffer[(i + 1)...])
      guard let m = (try? JSONSerialization.jsonObject(with: line)) as? [String: String] else { continue }
      let content = UNMutableNotificationContent()
      content.title = m["title"] ?? "AgentView"
      content.subtitle = m["subtitle"] ?? ""
      content.body = m["body"] ?? ""
      content.sound = UNNotificationSound(named: UNNotificationSoundName("Glass"))
      if let url = m["url"] { content.userInfo = ["url": url] }
      UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
  }

  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    if let s = r.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) { NSWorkspace.shared.open(url) } else { onClick() }
    done()
  }
}

final class Bar: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let awakeItem = NSMenuItem(title: "Keep Mac awake", action: #selector(toggleAwake), keyEquivalent: "")
  let loginItem = NSMenuItem(title: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
  var assertion: IOPMAssertionID = 0
  let relay = Child("relay", "bun server/src/relay.ts", env: ["AGENTVIEW_RELAY_TOKEN": token])
  let server = Child("server", "./serve.sh", env: ["CHROME_CDP": "ws://127.0.0.1:7779/\(token)", "AGENTVIEW_DEV_WEB": ""])
  let notifier = Notifier()

  func applicationDidFinishLaunching(_ n: Notification) {
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: logs.deletingLastPathComponent().path)
    notifier.onClick = { [weak self] in self?.openApp() }
    notifier.start()
    let menu = NSMenu()
    menu.addItem(withTitle: "Open AgentView", action: #selector(openApp), keyEquivalent: "o").target = self
    menu.addItem(withTitle: "Restart server", action: #selector(restartServer), keyEquivalent: "r").target = self
    menu.addItem(withTitle: "Open Chrome remote debugging", action: #selector(openChrome), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Show logs", action: #selector(showLogs), keyEquivalent: "").target = self
    menu.addItem(.separator())
    awakeItem.target = self
    menu.addItem(awakeItem)
    loginItem.target = self
    loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(loginItem)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit AgentView", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.menu = menu
    setAwake(true)
    freePorts([7779, 7777, 5173])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      self.relay.start()
      self.server.start()
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    openApp()
    return false
  }

  func applicationWillTerminate(_ n: Notification) {
    [server, relay].forEach { $0.stop() }
  }

  func setAwake(_ on: Bool) {
    if on {
      IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "AgentView" as CFString, &assertion)
    } else if assertion != 0 {
      IOPMAssertionRelease(assertion)
      assertion = 0
    }
    awakeItem.state = on ? .on : .off
    item.button?.image = NSImage(systemSymbolName: on ? "cup.and.saucer.fill" : "cup.and.saucer", accessibilityDescription: "AgentView")
    item.button?.toolTip = on ? "AgentView: keeping Mac awake" : "AgentView"
  }

  @objc func toggleAwake() { setAwake(assertion == 0) }
  @objc func openApp() { NSWorkspace.shared.open(URL(string: "http://localhost:7777")!) }
  @objc func restartServer() { server.restart() }
  @objc func showLogs() { NSWorkspace.shared.open(logs) }

  @objc func openChrome() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    p.arguments = ["-a", "Google Chrome", "chrome://inspect/#remote-debugging"]
    try? p.run()
  }

  @objc func toggleLogin() {
    let s = SMAppService.mainApp
    do {
      if s.status == .enabled { try s.unregister() } else { try s.register() }
    } catch {
      NSAlert(error: error).runModal()
    }
    loginItem.state = s.status == .enabled ? .on : .off
  }
}

let app = NSApplication.shared
let bar = Bar()
app.delegate = bar
app.setActivationPolicy(.accessory)
app.run()
