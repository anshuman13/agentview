package no.pradhan.agentview.nativeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

private const val PHOTO_MAX_PX = 2048

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

private fun readUri(ctx: Context, uri: Uri) = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }

// The add button with Take photo and Choose photo, or with choose off a camera button; each image is uploaded to the Mac and its path handed to onPath.
@Composable
fun AttachButton(hub: Hub, onUploading: (Int) -> Unit, choose: Boolean = true, onPath: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    val shot = remember { File(File(ctx.cacheDir, "camera").apply { mkdirs() }, "shot.jpg") }

    fun upload(name: String, mime: String, read: () -> ByteArray?) {
        scope.launch {
            onUploading(1)
            val bytes = withContext(Dispatchers.IO) { runCatching(read).getOrNull() }
            val path = bytes?.let { hub.attach(name, mime, it) }
            onUploading(-1)
            if (path != null) onPath(path) else if (bytes == null) hub.notice.value = "Could not read the image"
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

    val takePhoto = {
        shot.delete()
        runCatching { camera.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", shot)) }
            .onFailure { hub.notice.value = "No camera app to take a photo" }
        Unit
    }

    if (!choose) return IconBtn("device-camera", "Take photo", takePhoto)
    Box {
        IconBtn("add", "Attach image", { open = true })
        Menu(open, { open = false }) {
            MenuItem("Take photo", "device-camera", { open = false; takePhoto() })
            MenuItem("Choose photo", "file-media", {
                open = false
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
        }
    }
}
