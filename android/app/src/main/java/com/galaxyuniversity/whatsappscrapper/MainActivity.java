package com.galaxyuniversity.whatsappscrapper;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.graphics.Color;

public final class MainActivity extends Activity {
    private static final String PREFS = "wa_android_settings";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "http://127.0.0.1:8787/";
    private static final int FILE_CHOOSER_REQUEST = 7214;

    private EditText urlInput;
    private TextView status;
    private ProgressBar progress;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String activeHost = "127.0.0.1";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildLayout();
        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, DEFAULT_URL);
        urlInput.setText(saved);
        loadServer(saved);
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(17, 20, 17));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(7), dp(8), dp(7));
        bar.setBackgroundColor(Color.rgb(27, 33, 27));

        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setTextColor(Color.WHITE);
        urlInput.setHintTextColor(Color.LTGRAY);
        urlInput.setHint("https://your-deployed-server.example/");
        urlInput.setTextSize(12);
        urlInput.setPadding(dp(9), 0, dp(9), 0);
        urlInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        bar.addView(urlInput, new LinearLayout.LayoutParams(0, dp(42), 1f));

        Button connect = new Button(this);
        connect.setText("فتح");
        connect.setTextSize(12);
        connect.setOnClickListener(v -> loadServer(urlInput.getText().toString()));
        bar.addView(connect, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)));
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                loadServer(urlInput.getText().toString());
                return true;
            }
            return false;
        });

        status = new TextView(this);
        status.setTextColor(Color.rgb(190, 218, 159));
        status.setTextSize(11);
        status.setPadding(dp(12), dp(5), dp(12), dp(5));
        status.setText("جاهز للاتصال بالخدمة");
        root.addView(bar);
        root.addView(status);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(17, 20, 17));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedHttpAuthRequest(WebView view, android.webkit.HttpAuthHandler handler, String host, String realm) {
                LinearLayout form = new LinearLayout(MainActivity.this);
                form.setOrientation(LinearLayout.VERTICAL);
                form.setPadding(dp(20), dp(8), dp(20), 0);

                EditText username = new EditText(MainActivity.this);
                username.setSingleLine(true);
                username.setHint("اسم المستخدم الإداري");
                username.setText("admin");
                form.addView(username, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

                EditText password = new EditText(MainActivity.this);
                password.setSingleLine(true);
                password.setHint("كلمة مرور الخادم");
                password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
                form.addView(password, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

                AlertDialog dialog = new AlertDialog.Builder(MainActivity.this)
                    .setTitle("تسجيل دخول الخادم")
                    .setMessage("الخادم " + host + " يطلب بيانات الإدارة. لا تستخدم بيانات حساب WhatsApp هنا.")
                    .setView(form)
                    .setPositiveButton("اتصال", (d, which) -> {
                        String user = username.getText().toString().trim();
                        String pass = password.getText().toString();
                        if (user.isEmpty() || pass.isEmpty()) {
                            handler.cancel();
                            setStatus("بيانات دخول الخادم مطلوبة");
                        } else {
                            handler.proceed(user, pass);
                            setStatus("جارٍ التحقق من بيانات الخادم…");
                        }
                    })
                    .setNegativeButton("إلغاء", (d, which) -> {
                        handler.cancel();
                        setStatus("تم إلغاء تسجيل الدخول");
                    })
                    .create();
                dialog.setOnCancelListener(d -> handler.cancel());
                dialog.show();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                String host = uri.getHost();
                boolean local = "127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host) || "::1".equals(host);
                boolean sameHost = host != null && host.equalsIgnoreCase(activeHost);
                if (sameHost && ("https".equals(scheme) || ("http".equals(scheme) && local))) return false;
                if ("https".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        setStatus("لا يوجد تطبيق لفتح هذا الرابط");
                    }
                } else {
                    setStatus("تم حظر رابط HTTP غير موثوق");
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                setStatus("جارٍ الاتصال بالخدمة…");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                setStatus("تم تحميل الواجهة — تأكد من حالة الخدمة");
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    setStatus("تعذر الاتصال. شغّل خدمة Node.js في Termux أو تحقق من رابط الخادم.");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent;
                try {
                    intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    setStatus("تعذر فتح منتقي الملفات");
                    return false;
                }
            }
        });

        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void loadServer(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) value = DEFAULT_URL;
        if (!value.matches("(?i)^https?://.+")) value = "https://" + value;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost();
        if (host == null || (!"https".equals(scheme) && !"http".equals(scheme))) {
            showInvalidUrl();
            return;
        }
        boolean local = "127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host) || "::1".equals(host);
        if ("http".equals(scheme) && !local) {
            new AlertDialog.Builder(this)
                .setTitle("اتصال غير مشفر")
                .setMessage("لأمان بيانات الحسابات، استخدم HTTPS للخوادم البعيدة. يسمح HTTP فقط للخدمة المحلية على هذا الهاتف.")
                .setPositiveButton("حسنًا", null)
                .show();
            return;
        }
        if (value.indexOf('@') >= 0) {
            showInvalidUrl();
            return;
        }
        if (!value.endsWith("/")) value += "/";
        urlInput.setText(value);
        activeHost = host;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, value).apply();
        setStatus("الاتصال بـ " + host);
        webView.loadUrl(value);
    }

    private void showInvalidUrl() {
        new AlertDialog.Builder(this)
            .setTitle("رابط غير صالح")
            .setMessage("أدخل رابط HTTP محليًا (127.0.0.1) أو رابط HTTPS لخادم موثوق.")
            .setPositiveButton("حسنًا", null)
            .show();
    }

    private void setStatus(String text) {
        if (status != null) status.setText(text);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
