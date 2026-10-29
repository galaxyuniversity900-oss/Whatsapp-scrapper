package com.galaxyuniversity.whatsappscrapper

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.text.InputType
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var fallback: LinearLayout
    private var pageLoaded = false
    private var usingBundledUi = false
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cloudBaseUrl: String? = null

    private val localUrl = "http://127.0.0.1:8787/"
    private val bundledUrl = "file:///android_asset/index.html"
    private val termuxPackage = "com.termux"
    private val fileChooserRequestCode = 1001

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        cloudBaseUrl = getSharedPreferences("wa_workspace", MODE_PRIVATE).getString("cloud_base_url", null)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(17, 20, 17))
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setSupportZoom(false)
            addJavascriptInterface(WebAppBridge(), "AndroidBridge")

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    return try {
                        val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        startActivityForResult(intent, fileChooserRequestCode)
                        true
                    } catch (_: Exception) {
                        filePathCallback?.onReceiveValue(null)
                        filePathCallback = null
                        false
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    val url = uri.toString()
                    val cloudHost = runCatching { Uri.parse(cloudBaseUrl).host }.getOrNull()
                    if (uri.scheme == "file" || uri.host == "127.0.0.1" || uri.host == "localhost" || (cloudHost != null && uri.host == cloudHost)) return false
                    if (uri.scheme == "https" || uri.scheme == "http" ||
                        url.startsWith("whatsapp://") || url.startsWith("tg://")) {
                        return openExternal(url)
                    }
                    return true
                }

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (url.startsWith(localUrl) || url == bundledUrl || cloudBaseUrl?.let { url.startsWith(it) } == true) {
                        pageLoaded = false
                        fallback.visibility = View.GONE
                        webView.visibility = View.VISIBLE
                    }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    if (url.startsWith(localUrl) || url == bundledUrl || cloudBaseUrl?.let { url.startsWith(it) } == true) {
                        pageLoaded = true
                        usingBundledUi = (url == bundledUrl)
                        fallback.visibility = View.GONE
                        webView.visibility = View.VISIBLE
                    }
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    super.onReceivedError(view, request, error)
                    if (!request.isForMainFrame) return
                    if (!usingBundledUi) {
                        loadBundledUi()
                    } else {
                        showFallback()
                    }
                }
            }
        }

        fallback = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 36, 28, 24)
            setBackgroundColor(Color.rgb(17, 20, 17))
            visibility = View.GONE
            addView(TextView(this@MainActivity).apply {
                text = "WA Workspace"
                textSize = 23f
                setTextColor(Color.WHITE)
            })
            addView(TextView(this@MainActivity).apply {
                text = "The local service is unavailable and the bundled interface could not be opened. You can start the existing Termux service or retry. Project data is not deleted."
                textSize = 15f
                setTextColor(Color.LTGRAY)
                setPadding(0, 14, 0, 20)
            })
            addView(Button(this@MainActivity).apply {
                text = "Start server in Termux"
                setOnClickListener { startTermuxServer() }
            })
            addView(Button(this@MainActivity).apply {
                text = "Open Termux"
                setOnClickListener { openTermux() }
            })
            addView(Button(this@MainActivity).apply {
                text = "Retry local server"
                setOnClickListener { loadLocalServer() }
            })
            addView(Button(this@MainActivity).apply {
                text = "Open bundled interface"
                setOnClickListener { loadBundledUi() }
            })
            addView(Button(this@MainActivity).apply {
                text = "Connect cloud server"
                setOnClickListener { promptCloudServer() }
            })
        }

        root.addView(Button(this).apply {
            text = "Connect cloud server"
            setOnClickListener { promptCloudServer() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(fallback, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        if (savedInstanceState != null) {
            val restored = webView.restoreState(savedInstanceState)
            if (restored == null) loadLocalServer()
        } else {
            loadLocalServer()
        }
    }

    private fun startTermuxServer() {
        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setClassName(termuxPackage, "com.termux.app.RunCommandService")
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", "cd \"\$HOME/Whatsapp-scrapper\" && bash scripts/termux-service.sh start"))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        }
        try {
            startService(intent)
            Toast.makeText(this, "Start request sent. Trying the local service…", Toast.LENGTH_LONG).show()
            pageLoaded = false
            retryServerConnection(0)
        } catch (_: SecurityException) {
            Toast.makeText(this, "Enable Allow external apps in Termux Settings, then try again.", Toast.LENGTH_LONG).show()
            openTermux()
        } catch (_: Exception) {
            Toast.makeText(this, "Could not start Termux command. Open Termux and start the project manually.", Toast.LENGTH_LONG).show()
            openTermux()
        }
    }

    private fun retryServerConnection(attempt: Int) {
        if (pageLoaded) return
        if (attempt >= 10) {
            loadBundledUi()
            Toast.makeText(this, "Local server did not respond. Opened the bundled interface; server-backed functions still need the service.", Toast.LENGTH_LONG).show()
            return
        }
        webView.postDelayed({
            if (!pageLoaded) {
                webView.loadUrl(localUrl)
                retryServerConnection(attempt + 1)
            }
        }, 1500L)
    }

    private fun loadLocalServer() {
        pageLoaded = false
        usingBundledUi = false
        fallback.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(localUrl)
    }

    private fun promptCloudServer() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "https://your-service.example.com"
            setText(cloudBaseUrl.orEmpty())
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Connect cloud server")
            .setMessage("Enter the HTTPS URL of your deployed WA Workspace server. The server must already be deployed and reachable.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Connect") { _, _ ->
                val raw = input.text.toString().trim().trimEnd('/')
                val uri = runCatching { Uri.parse(raw) }.getOrNull()
                if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank()) {
                    Toast.makeText(this, "Use a valid HTTPS server URL.", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }
                cloudBaseUrl = raw
                getSharedPreferences("wa_workspace", MODE_PRIVATE).edit().putString("cloud_base_url", raw).apply()
                pageLoaded = false
                webView.loadUrl("$raw/")
            }
            .setNeutralButton("Clear saved server") { _, _ ->
                cloudBaseUrl = null
                getSharedPreferences("wa_workspace", MODE_PRIVATE).edit().remove("cloud_base_url").apply()
                Toast.makeText(this, "Saved cloud server cleared.", Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun loadBundledUi() {
        pageLoaded = false
        usingBundledUi = true
        fallback.visibility = View.GONE
        webView.visibility = View.VISIBLE
        val local = Uri.encode(localUrl.trimEnd('/'))
        val cloud = cloudBaseUrl?.takeIf { it.startsWith("https://", ignoreCase = true) }?.let { "&backend=" + Uri.encode(it) } ?: ""
        // Query parameters are available before the bundled page's first script runs.
        webView.loadUrl("$bundledUrl?local=$local$cloud")
    }

    private fun showFallback() {
        webView.visibility = View.GONE
        fallback.visibility = View.VISIBLE
    }

    private fun openTermux() {
        try {
            val launch = packageManager.getLaunchIntentForPackage(termuxPackage)
            if (launch != null) startActivity(launch)
            else {
                Toast.makeText(this, "Install Termux from its official distribution first.", Toast.LENGTH_LONG).show()
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/termux/termux-app/releases")))
            }
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Install Termux first.", Toast.LENGTH_LONG).show()
        }
    }

    private fun openExternal(url: String): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            true
        } catch (_: Exception) {
            false
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != fileChooserRequestCode) return
        val results = if (resultCode == RESULT_OK && data != null) {
            WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        } else null
        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
    }

    inner class WebAppBridge {
        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, message.take(200), Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
            if (uri.scheme == "https" || uri.scheme == "http" || uri.scheme == "whatsapp" || uri.scheme == "tg") {
                runOnUiThread { openExternal(url) }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}
