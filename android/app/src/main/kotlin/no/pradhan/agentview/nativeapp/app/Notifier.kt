package no.pradhan.agentview.nativeapp.app

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import no.pradhan.agentview.nativeapp.MainActivity
import no.pradhan.agentview.nativeapp.NoticeReceiver
import no.pradhan.agentview.nativeapp.R
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT

private const val WAITING_CHANNEL = "needs"
private const val WAITING_ID = 1
private const val RUNNING_CHANNEL = "running"
const val EXTRA_CHAT = "chat"
const val EXTRA_NOTICE_ID = "noticeId"
const val EXTRA_SLUG = "slug"
const val EXTRA_PERMISSION = "permission"
const val EXTRA_CHANNEL = "channel"
const val EXTRA_READONLY = "readonly"
const val KEY_REPLY = "reply"

// Notifications while the app is in the background (web/src/app/notify.ts) and the ongoing list of chats that wait for you.
class Notifier(private val app: Application) {
    private val manager = NotificationManagerCompat.from(app)

    init {
        NoticeKind.entries.forEach { k ->
            val importance = if (k == NoticeKind.Approval) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            manager.createNotificationChannel(NotificationChannel(k.channel, k.label, importance))
        }
        manager.createNotificationChannel(NotificationChannel(WAITING_CHANNEL, "Needs you", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(true) })
        manager.createNotificationChannel(NotificationChannel(RUNNING_CHANNEL, "Running chats", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
    }

    fun granted() = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(link: String, code: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link), app, MainActivity::class.java)
        return PendingIntent.getActivity(app, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun action(op: String, chat: String, id: Int, channel: String, label: String, permissionId: String = "", reply: Boolean = false, slug: String = ""): NotificationCompat.Action {
        val intent = Intent(op).setClass(app, NoticeReceiver::class.java)
            .putExtra(EXTRA_CHAT, chat).putExtra(EXTRA_NOTICE_ID, id).putExtra(EXTRA_CHANNEL, channel).putExtra(EXTRA_PERMISSION, permissionId).putExtra(EXTRA_SLUG, slug).putExtra(EXTRA_READONLY, AppState.readOnly)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (reply) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        val builder = NotificationCompat.Action.Builder(0, label, PendingIntent.getBroadcast(app, (op + id).hashCode(), intent, flags))
        if (reply) builder.addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build())
        return builder.build()
    }

    @android.annotation.SuppressLint("MissingPermission")
    fun post(n: Notice) {
        if (!granted()) return
        val id = noticeId(n)
        val builder = NotificationCompat.Builder(app, n.kind.channel)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setContentIntent(open(chatLink(n.chatId, n.slug), id))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        if (n.detail.isNotEmpty()) builder.setStyle(NotificationCompat.BigTextStyle().bigText(n.detail))
        val replies = n.ask == NoticeAsk.Question || n.kind == NoticeKind.Finished
        if (n.ask == NoticeAsk.Permission) {
            builder.addAction(action(NoticeOp.ALLOW, n.chatId, id, n.kind.channel, "Allow", n.permissionId))
            builder.addAction(action(NoticeOp.DENY, n.chatId, id, n.kind.channel, "Deny", n.permissionId))
        }
        if (replies) builder.addAction(action(NoticeOp.REPLY, n.chatId, id, n.kind.channel, "Reply", reply = true))
        if (n.slug.isNotEmpty() && !AppState.readOnly) builder.addAction(action(NoticeOp.APPROVE, n.chatId, id, n.kind.channel, "Approve", slug = n.slug))
        manager.notify(id, builder.build())
    }

    // After an action: the notification goes away, or shows why nothing was sent.
    @android.annotation.SuppressLint("MissingPermission")
    fun settle(id: Int, channel: String, chat: String, result: ActionResult) {
        when (result) {
            ActionResult.Sent -> manager.cancel(id)
            else -> {
                if (!granted()) return
                val text = if (result is ActionResult.Failed) result.text else READ_ONLY_SENT
                manager.notify(id, NotificationCompat.Builder(app, channel).setSmallIcon(R.drawable.ic_notify).setContentTitle(text).setContentIntent(open(chatLink(chat), id)).setAutoCancel(true).build())
            }
        }
    }

    fun clear(chat: String) = NoticeKind.entries.forEach { manager.cancel((it.channel + chat).hashCode()) }

    fun clearChats() = manager.activeNotifications.filter { it.id != WAITING_ID && !(it.notification.channelId == RUNNING_CHANNEL && it.isOngoing) }.forEach { manager.cancel(it.id) }

    private fun runningId(chat: String) = (RUNNING_CHANNEL + chat).hashCode()

    // One ongoing, silent notification per running chat: title, status, elapsed time and Stop, or Allow and Deny for a permission request.
    // The actions answer under their own id, so a failed one does not replace the notification.
    @android.annotation.SuppressLint("MissingPermission")
    fun running(notes: List<RunningNote>) {
        val active = if (granted()) notes else emptyList()
        val keep = active.map { runningId(it.chatId) }.toSet()
        manager.activeNotifications.filter { it.notification.channelId == RUNNING_CHANNEL && it.isOngoing && it.id !in keep }.forEach { manager.cancel(it.id) }
        active.forEach { n ->
            val id = runningId(n.chatId)
            val builder = NotificationCompat.Builder(app, RUNNING_CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(n.title)
                .setContentText(if (n.pending) "Needs you" else n.text)
                .setWhen(n.since)
                .setUsesChronometer(true)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setContentIntent(open(chatLink(n.chatId), id))
            if (!AppState.readOnly) {
                val reply = id + 1
                when {
                    n.permissionId.isNotEmpty() -> {
                        builder.addAction(action(NoticeOp.ALLOW, n.chatId, reply, RUNNING_CHANNEL, "Allow", n.permissionId))
                        builder.addAction(action(NoticeOp.DENY, n.chatId, reply, RUNNING_CHANNEL, "Deny", n.permissionId))
                    }
                    !n.pending -> builder.addAction(action(NoticeOp.STOP, n.chatId, reply, RUNNING_CHANNEL, "Stop"))
                }
            }
            manager.notify(id, builder.build())
        }
    }

    // One ongoing, silent list of the chats that wait for you; the launcher shows its count on the app icon.
    @android.annotation.SuppressLint("MissingPermission")
    fun waiting(snap: WaitingSnapshot, badge: Int = snap.total) {
        if (badge == 0 || !granted()) { manager.cancel(WAITING_ID); return }
        val text = if (snap.total > 0) "${snap.total} ${if (snap.total == 1) "chat" else "chats"} waiting" else "$badge ${if (badge == 1) "item" else "items"} in Needs you"
        val style = NotificationCompat.InboxStyle().setBigContentTitle("Needs you").setSummaryText(text)
        snap.lines.forEach { style.addLine(it.text()) }
        val built = NotificationCompat.Builder(app, WAITING_CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Needs you")
            .setContentText(text)
            .setStyle(style)
            .setNumber(badge)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open(sessionsLink, WAITING_ID))
            .build()
        manager.notify(WAITING_ID, built)
    }
}
