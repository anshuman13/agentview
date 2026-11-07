package no.pradhan.agentview.nativeapp

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
import androidx.core.content.ContextCompat

private const val BADGE_CHANNEL = "needs"
private const val BADGE_ID = 1

// Notifications while the app is in the background (web/src/app/notify.ts) and the launcher count (launcherBadge.ts).
class Notifier(private val app: Application) {
    private val manager = NotificationManagerCompat.from(app)

    init {
        NoticeKind.entries.forEach { k ->
            val importance = if (k == NoticeKind.Approval) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            manager.createNotificationChannel(NotificationChannel(k.channel, k.label, importance))
        }
        manager.createNotificationChannel(NotificationChannel(BADGE_CHANNEL, "Needs you", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(true) })
    }

    fun granted() = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(chat: String?, code: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(chat?.let(::chatLink) ?: "agentview://open?view=assistant"), app, MainActivity::class.java)
        return PendingIntent.getActivity(app, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    @android.annotation.SuppressLint("MissingPermission")
    fun post(n: Notice) {
        if (!granted()) return
        val id = (n.kind.channel + n.chatId).hashCode()
        val built = NotificationCompat.Builder(app, n.kind.channel)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setContentIntent(open(n.chatId, id))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        manager.notify(id, built)
    }

    fun clear(chat: String) = NoticeKind.entries.forEach { manager.cancel((it.channel + chat).hashCode()) }

    fun clearChats() = manager.activeNotifications.filter { it.id != BADGE_ID }.forEach { manager.cancel(it.id) }

    // The launcher shows this count on the app icon while the notification is active.
    @android.annotation.SuppressLint("MissingPermission")
    fun badge(count: Int) {
        val n = badgeArg(count)
        if (n == 0 || !granted()) { manager.cancel(BADGE_ID); return }
        val built = NotificationCompat.Builder(app, BADGE_CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Needs you")
            .setContentText("$n waiting")
            .setNumber(n)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open(null, BADGE_ID))
            .build()
        manager.notify(BADGE_ID, built)
    }
}
