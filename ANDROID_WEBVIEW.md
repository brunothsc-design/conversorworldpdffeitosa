# Guia de Segurança e Integração WebView para APK (Android)

URL de produção configurada: **`https://conversorworldpdffeitosa.netlify.app/`**

---

## 1. Proteções ativas no site e no Netlify

1. **Cabeçalhos HTTP de segurança (`netlify.toml`):**
   - `Strict-Transport-Security`: força HTTPS (`max-age=31536000; includeSubDomains; preload`).
   - `Content-Security-Policy`: bloqueia scripts externos e `eval` (`default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`).
   - `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy` e `Permissions-Policy` desativando câmera, microfone, GPS e pagamentos.
2. **Proteção na conversão local (`src/services/converter.ts`):**
   - Validação de assinatura binária dos arquivos (`PK` para `.docx` e `%PDF-` para `.pdf`).
   - Limites de segurança contra travamento do WebView: máximo de **50 MB** por arquivo, **300 páginas** por PDF e **4096 px** por imagem.
   - Bloqueio de URLs externas e SVG em imagens extraídas do Word (aceita apenas `data:image/(png|jpeg|jpg|gif|webp|bmp);base64`).
   - `isEvalSupported: false` no `PDF.js` para rodar sem `eval`.
3. **Proteção da ponte nativa (`src/utils/webview.ts`):**
   - A ponte nativa só é acionada na origem confiável (`conversorworldpdffeitosa.netlify.app`) com sanitização estrita de nome de arquivo e validação do tipo MIME.

---

## 2. Configuração segura do APK no Android Studio (Kotlin)

### `res/xml/network_security_config.xml`
Bloqueia tráfego HTTP sem criptografia em todo o aplicativo:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

### `AndroidManifest.xml`
```xml
<uses-permission android:name="android.permission.INTERNET" />
<!-- Apenas para Android 9 (API 28) ou inferior -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

<application
    android:allowBackup="false"
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="false">
    ...
</application>
```

### `MainActivity.kt` (WebView blindado para `conversorworldpdffeitosa.netlify.app`)
```kotlin
package com.wordpdf.app

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    companion object {
        private const val APP_URL = "https://conversorworldpdffeitosa.netlify.app/"
        private val ALLOWED_HOSTS = setOf("conversorworldpdffeitosa.netlify.app")
        private val ALLOWED_MIMES = setOf(
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        private const val MAX_DECODED_BYTES = 50 * 1024 * 1024 // 50 MB
    }

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = true // Necessário apenas para o seletor de arquivos
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.setGeolocationEnabled(false)

        webView.addJavascriptInterface(AndroidDownloadBridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // Permite apenas HTTPS no domínio oficial do app; bloqueia esquemas perigosos
                return !(url.scheme == "https" && url.host in ALLOWED_HOSTS)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf(
                            "application/pdf",
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        )
                    )
                }
                fileChooserLauncher.launch(Intent.createChooser(intent, "Selecionar documento"))
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })

        webView.loadUrl(APP_URL)
    }

    inner class AndroidDownloadBridge {
        @JavascriptInterface
        fun saveFile(base64Data: String, rawFileName: String, mimeType: String) {
            runOnUiThread {
                try {
                    val currentHost = Uri.parse(webView.url ?: "").host
                    if (currentHost !in ALLOWED_HOSTS) return@runOnUiThread
                    if (mimeType !in ALLOWED_MIMES) return@runOnUiThread

                    val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                    if (bytes.isEmpty() || bytes.size > MAX_DECODED_BYTES) return@runOnUiThread

                    val safeName = File(rawFileName).name
                        .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                        .trimStart('.')
                        .ifEmpty { "documento" }
                        .take(120)

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                            put(MediaStore.Downloads.MIME_TYPE, mimeType)
                            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        }
                        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        uri?.let {
                            contentResolver.openOutputStream(it)?.use { out -> out.write(bytes) }
                        }
                    } else {
                        val downloadsDir =
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        val file = File(downloadsDir, safeName)
                        FileOutputStream(file).use { out -> out.write(bytes) }
                    }
                    Toast.makeText(
                        this@MainActivity,
                        "Arquivo salvo em Downloads: $safeName",
                        Toast.LENGTH_LONG
                    ).show()
                } catch (e: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        "Erro ao salvar arquivo.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }
}
```
