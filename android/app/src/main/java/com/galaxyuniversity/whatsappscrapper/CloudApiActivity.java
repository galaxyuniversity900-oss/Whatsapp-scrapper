package com.galaxyuniversity.whatsappscrapper;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class CloudApiActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private EditText phoneNumberId;
    private EditText accessToken;
    private EditText recipient;
    private EditText message;
    private TextView status;
    private Button sendButton;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
    }

    private void buildUi() {
        int bg = Color.rgb(17, 20, 17);
        int fg = Color.WHITE;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(24));
        root.setBackgroundColor(bg);
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("WhatsApp Business Cloud API");
        title.setTextColor(Color.rgb(190, 218, 159));
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(title, params(-1, -2, 0, 0, 0, 0));

        TextView intro = new TextView(this);
        intro.setText("وضع مستقل عن Termux والخادم المحلي. يتطلب حساب WhatsApp Business Platform وبيانات API صالحة واتصال إنترنت. لا تدخل كلمة مرور حساب WhatsApp.");
        intro.setTextColor(Color.LTGRAY);
        intro.setTextSize(14);
        root.addView(intro, params(-1, -2, 0, dp(8), 0, dp(16)));

        phoneNumberId = field("Phone Number ID", false);
        accessToken = field("Access Token (لا يتم حفظه)", true);
        recipient = field("رقم المستلم مع مفتاح الدولة، أرقام فقط", false);
        message = field("نص الرسالة", false);
        message.setSingleLine(false);
        message.setMinLines(4);
        message.setGravity(Gravity.TOP | Gravity.START);
        message.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);

        Button back = new Button(this);
        back.setText("العودة");
        back.setOnClickListener(v -> finish());
        root.addView(back, params(-1, dp(48), 0, dp(12), 0, dp(6)));

        sendButton = new Button(this);
        sendButton.setText("إرسال عبر Cloud API");
        sendButton.setOnClickListener(v -> sendMessage());
        root.addView(sendButton, params(-1, dp(52), 0, dp(6), 0, dp(6)));

        status = new TextView(this);
        status.setTextColor(Color.rgb(190, 218, 159));
        status.setTextSize(14);
        status.setText("جاهز. لم يتم إرسال أي رسالة.");
        root.addView(status, params(-1, -2, 0, dp(12), 0, 0));
        setContentView(scroll);
    }

    private EditText field(String hint, boolean secret) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setHintTextColor(Color.LTGRAY);
        edit.setTextColor(Color.WHITE);
        edit.setTextSize(14);
        edit.setSingleLine(!secret);
        edit.setPadding(dp(12), dp(8), dp(12), dp(8));
        edit.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(110, 130, 110)));
        if (secret) edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        else edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        LinearLayout root = (LinearLayout) ((ScrollView) findViewById(android.R.id.content)).getChildAt(0);
        root.addView(edit, params(-1, secret ? dp(54) : dp(52), 0, dp(5), 0, dp(5)));
        return edit;
    }

    private void sendMessage() {
        final String id = phoneNumberId.getText().toString().trim();
        final String token = accessToken.getText().toString().trim();
        final String to = recipient.getText().toString().replaceAll("[^0-9]", "");
        final String body = message.getText().toString().trim();
        if (id.isEmpty() || token.isEmpty() || to.isEmpty() || body.isEmpty()) {
            status.setText("أكمل Phone Number ID وAccess Token ورقم المستلم والرسالة.");
            return;
        }
        if (!id.matches("[0-9]{5,30}") || !to.matches("[0-9]{7,15}")) {
            status.setText("تحقق من Phone Number ID ورقم المستلم مع مفتاح الدولة.");
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("تأكيد الإرسال")
            .setMessage("سيتم إرسال رسالة إلى الرقم " + to + " عبر WhatsApp Business Cloud API. أرسل فقط إلى أشخاص وافقوا على تلقي الرسائل.")
            .setNegativeButton("إلغاء", null)
            .setPositiveButton("إرسال", (dialog, which) -> performSend(id, token, to, body))
            .show();
    }

    private void performSend(String id, String token, String to, String body) {
        sendButton.setEnabled(false);
        status.setText("جارٍ الاتصال بـ Meta…");
        executor.execute(() -> {
            HttpURLConnection connection = null;
            String responseText = "";
            int statusCode = -1;
            try {
                URL url = new URL("https://graph.facebook.com/v23.0/" + id + "/messages");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                JSONObject text = new JSONObject();
                text.put("body", body);
                JSONObject payload = new JSONObject();
                payload.put("messaging_product", "whatsapp");
                payload.put("recipient_type", "individual");
                payload.put("to", to);
                payload.put("type", "text");
                payload.put("text", text);
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                statusCode = connection.getResponseCode();
                InputStream stream = statusCode >= 200 && statusCode < 400 ? connection.getInputStream() : connection.getErrorStream();
                if (stream != null) {
                    StringBuilder response = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) response.append(line);
                    }
                    responseText = response.toString();
                }
            } catch (Exception e) {
                responseText = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
            final int code = statusCode;
            final String result = responseText;
            runOnUiThread(() -> {
                sendButton.setEnabled(true);
                if (code >= 200 && code < 300) {
                    String idValue = "";
                    try { idValue = new JSONObject(result).optJSONArray("messages") != null
                        ? new JSONObject(result).optJSONArray("messages").optJSONObject(0).optString("id", "")
                        : ""; } catch (Exception ignored) {}
                    status.setText("قبلت Meta الطلب (HTTP " + code + ")." +
                        (idValue.isEmpty() ? "" : "\nMessage ID: " + idValue) +
                        "\nهذا لا يثبت التسليم النهائي؛ راجع حالة الرسالة في WhatsApp Manager.");
                    accessToken.setText("");
                } else {
                    String safe = result.length() > 700 ? result.substring(0, 700) + "…" : result;
                    status.setText("فشل الإرسال (HTTP " + code + ").\n" + safe);
                }
            });
        });
    }

    private LinearLayout.LayoutParams params(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(width < 0 ? width : dp(width), height < 0 ? height : dp(height));
        p.setMargins(left, top, right, bottom);
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
