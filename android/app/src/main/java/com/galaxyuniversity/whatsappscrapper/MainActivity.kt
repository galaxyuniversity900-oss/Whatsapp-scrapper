package com.galaxyuniversity.whatsappscrapper

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var fallback: LinearLayout
    private val localUrl = "http://127.0.0.1:8787/"
    private val termuxPackage = "com.termux"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(17, 20, 17))
        }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    super.onReceivedError(view, request, error)
                    if (request.isForMainFrame) showFallback()
                }
            }
        }
        fallback = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 36, 28, 24)
            setBackgroundColor(Color.rgb(17, 20, 17))
            visibility = android.view.View.GONE
            addView(TextView(this@MainActivity).apply {
                text = "WA Workspace server is not running"
                textSize = 23f
                setTextColor(Color.WHITE)
            })
            addView(TextView(this@MainActivity).apply {
                text = "The Android app is the interface; WhatsApp services require the Node.js project in Termux. If Termux and ~/Whatsapp-scrapper are already installed, Start server will try to launch the service. For security, Termux must allow external apps to run commands."
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
                text = "Retry connection"
                setOnClickListener { loadLocalServer() }
            })
        }
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(fallback, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else loadLocalServer()
    }

    private fun startTermuxServer() {
        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setClassName(termuxPackage, "com.termux.app.RunCommandService")
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", "cd /data/data/com.termux/files/home/Whatsapp-scrapper && bash scripts/termux-service.sh start"))
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        }
        try {
            startService(intent)
            Toast.makeText(this, "Start request sent to Termux. Wait a few seconds, then tap Retry.", Toast.LENGTH_LONG).show()
            webView.postDelayed({ loadLocalServer() }, 3500)
        } catch (e: SecurityException) {
            Toast.makeText(this, "Termux blocked external commands. In Termux, enable Allow external apps in Settings, then try again.", Toast.LENGTH_LONG).show()
            openTermux()
        } catch (e: Exception) {
            Toast.makeText(this, "Could not start Termux command. Open Termux and start the project manually.", Toast.LENGTH_LONG).show()
            openTermux()
        }
    }

    private fun openTermux() {
        try {
            val launch = packageManager.getLaunchIntentForPackage(termuxPackage)
            if (launch != null) startActivity(launch)
            else {
                Toast.makeText(this, "Install Termux from its official F-Droid or GitHub distribution first.", Toast.LENGTH_LONG).show()
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/termux/termux-app/releases")))
            }
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Install Termux first.", Toast.LENGTH_LONG).show()
        }
    }

    private fun showFallback() {
        webView.visibility = android.view.View.GONE
        fallback.visibility = android.view.View.VISIBLE
    }

    private fun loadLocalServer() {
        fallback.visibility = android.view.View.GONE
        webView.visibility = android.view.View.VISIBLE
        webView.loadUrl(localUrl)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}
