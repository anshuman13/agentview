package no.pradhan.agentview.nativeapp.chat

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.lifecycle.viewModelScope
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.attach
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem

private const val PHOTO_MAX_PX = 2048
private const val MAX_FILE_BYTES = 50_000_000L

// A camera shot scaled to at most 2048 px on its long side and turned upright, so it uploads quickly over the VPN.
private fun shrunkJpeg(file: File): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= PHOTO_MAX_PX) sample *= 2
    val raw = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val turn = when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    val bmp = if (turn == 0f) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true)
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
}

private const val TOO_BIG = "Files over 50 MB cannot be attached"

private class FileTooBig : Exception()

// Reads at most MAX_FILE_BYTES + 1 bytes, so a provider that reports no size cannot fill the memory; over the limit it throws FileTooBig.
private fun readUri(ctx: Context, uri: Uri) = ctx.contentResolver.openInputStream(uri)?.use { s ->
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (out.size() <= MAX_FILE_BYTES) {
        val n = s.read(buf, 0, minOf(buf.size.toLong(), MAX_FILE_BYTES + 1 - out.size()).toInt())
        if (n < 0) return@use out.toByteArray()
        out.write(buf, 0, n)
    }
    throw FileTooBig()
}

// The add button with Take photo, Choose photo and Choose file, or with choose off a camera button; each upload goes to the Mac and its [Image: path] or [File: path] marker is handed to onPath.
@Composable
fun AttachButton(hub: Hub, onUploading: (Int) -> Unit, choose: Boolean = true, onPath: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val attach = rememberAttach(hub, onUploading, onPath = onPath)
    if (!choose) return IconBtn("device-camera", "Take photo", attach.takePhoto)
    Box {
        IconBtn("add", "Attach image", { open = true })
        Menu(open, { open = false }) {
            MenuItem("Take photo", "device-camera", { open = false; attach.takePhoto() })
            MenuItem("Choose photo", "file-media", { open = false; attach.choosePhoto() })
            MenuItem("Choose file", "file", { open = false; attach.chooseFile() })
        }
    }
}

class Attach(val takePhoto: () -> Unit, val choosePhoto: () -> Unit, val chooseFile: () -> Unit)

private tailrec fun Context.activity(): Activity? = this as? Activity ?: (this as? ContextWrapper)?.baseContext?.activity()

@Composable
// send uploads the bytes and returns what onPath gets, by default the chat's [Image: path] or [File: path] marker.
fun rememberAttach(
    hub: Hub,
    onUploading: (Int) -> Unit,
    send: suspend (name: String, mime: String, bytes: ByteArray) -> String? = { n, m, b -> hub.attach(n, m, b)?.let { attachMark(m, it) } },
    scan: Boolean = false,
    onPath: (String) -> Unit,
): Attach {
    val ctx = LocalContext.current
    val shot = remember { File(File(ctx.cacheDir, "camera").apply { mkdirs() }, "shot.jpg") }

    // In the Hub's scope, so leaving the screen mid-upload neither cancels it nor leaves the count stuck.
    fun upload(name: String, mime: String, read: () -> ByteArray?) {
        onUploading(1)
        hub.viewModelScope.launch {
            try {
                val got = withContext(Dispatchers.IO) { runCatching(read) }
                val bytes = got.getOrNull()
                val out = bytes?.let { send(name, mime, it) }
                if (out != null) onPath(out) else if (bytes == null) hub.notice.value = if (got.exceptionOrNull() is FileTooBig) TOO_BIG else "Could not read the file"
            } finally {
                onUploading(-1)
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
        upload("photo.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime) { readUri(ctx, uri) }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) upload("camera.jpg", "image/jpeg") { shrunkJpeg(shot) }
    }

    val camShot = {
        shot.delete()
        runCatching { camera.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", shot)) }
            .onFailure { hub.notice.value = "No camera app to take a photo" }
        Unit
    }

    // Google's document scanner, as in Drive: finds the page edges, straightens it and cleans it up.
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        val uri = GmsDocumentScanningResult.fromActivityResultIntent(res.data)?.pages?.firstOrNull()?.imageUri
        if (res.resultCode != Activity.RESULT_OK || uri == null) return@rememberLauncherForActivityResult
        upload("scan.jpg", "image/jpeg") {
            shot.delete()
            ctx.contentResolver.openInputStream(uri)?.use { i -> shot.outputStream().use { i.copyTo(it) } }
            shrunkJpeg(shot)
        }
    }
    val takePhoto = {
        val act = ctx.activity()
        if (!scan || act == null) camShot()
        else runCatching {
            GmsDocumentScanning.getClient(
                GmsDocumentScannerOptions.Builder()
                    .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                    .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                    .setPageLimit(1)
                    .setGalleryImportAllowed(true)
                    .build(),
            ).getStartScanIntent(act)
                .addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }
                .addOnFailureListener { camShot() }
        }.onFailure { camShot() }
        Unit
    }

    val document = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val (name, size) = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (!c.moveToFirst()) return@use null
            c.getColumnIndex(OpenableColumns.DISPLAY_NAME).let { if (it >= 0) c.getString(it) else null } to
                c.getColumnIndex(OpenableColumns.SIZE).let { if (it >= 0 && !c.isNull(it)) c.getLong(it) else 0L }
        } ?: (null to 0L)
        if (size > MAX_FILE_BYTES) { hub.notice.value = TOO_BIG; return@rememberLauncherForActivityResult }
        upload(name ?: uri.lastPathSegment ?: "file", ctx.contentResolver.getType(uri) ?: "application/octet-stream") { readUri(ctx, uri) }
    }

    return Attach(takePhoto, { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, { document.launch(arrayOf("*/*")) })
}
