import AppKit
import IOKit.pwr_mgt

final class Bar: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let awakeItem = NSMenuItem(title: "Keep Mac awake", action: #selector(toggle), keyEquivalent: "")
  var assertion: IOPMAssertionID = 0

  func applicationDidFinishLaunching(_ n: Notification) {
    let menu = NSMenu()
    awakeItem.target = self
    menu.addItem(awakeItem)
    menu.addItem(withTitle: "Open AgentView", action: #selector(openApp), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.menu = menu
    setAwake(true)
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

  @objc func toggle() { setAwake(assertion == 0) }
  @objc func openApp() { NSWorkspace.shared.open(URL(string: "http://localhost:5173")!) }
}

let app = NSApplication.shared
let bar = Bar()
app.delegate = bar
app.setActivationPolicy(.accessory)
app.run()
