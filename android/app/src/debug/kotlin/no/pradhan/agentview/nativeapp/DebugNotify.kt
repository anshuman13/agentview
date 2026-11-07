package no.pradhan.agentview.nativeapp

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// adb shell am broadcast -n no.pradhan.agentview.native/no.pradhan.agentview.nativeapp.DebugNotify --es kind approval --es chat <id> --ei badge 3
class DebugNotify : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val notifier = Notifier(context.applicationContext as Application)
        val kind = if (intent.getStringExtra("kind") == "finished") NoticeKind.Finished else NoticeKind.Approval
        val chat = intent.getStringExtra("chat") ?: "debug"
        notifier.post(Notice(kind, chat, if (kind == NoticeKind.Finished) "Claude finished in agentview" else "Claude needs you in agentview", "Debug notification"))
        if (intent.hasExtra("badge")) notifier.badge(intent.getIntExtra("badge", 0))
    }
}
