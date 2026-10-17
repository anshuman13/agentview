package no.pradhan.agentview

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.setDownloadListener { url, _, _, _, _ ->
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
  }
}
