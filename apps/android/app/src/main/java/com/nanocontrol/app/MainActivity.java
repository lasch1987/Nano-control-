package com.nanocontrol.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Nano Control para Android.
 *
 * Pantalla 1: busca tu Mac en la red (Bonjour) o deja escribir la IP a mano.
 * Pantalla 2: la superficie de control a pantalla completa (WebView acelerado por hardware),
 *             con la pantalla siempre encendida y el Wi‑Fi en modo de baja latencia.
 */
public class MainActivity extends Activity {

    private static final String SERVICE_TYPE = "_nanocontrol._tcp.";
    private static final int DEFAULT_PORT = 7777;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;

    private FrameLayout root;
    private WebView web;
    private View setupView;
    private LinearLayout foundList;
    private TextView statusText;
    private EditText hostField;

    private NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private boolean resolving = false;
    private final Map<String, String> found = new LinkedHashMap<>(); // nombre -> host:puerto

    private WifiManager.WifiLock wifiLock;
    private WifiManager.MulticastLock multicastLock;
    private boolean showingControl = false;

    // ───────────────────────── Ciclo de vida ─────────────────────────

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("nano", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 13, 16));
        setContentView(root);

        buildWebView();
        setupView = buildSetupView();
        root.addView(setupView);

        String last = prefs.getString("host", null);
        if (last != null) {
            hostField.setText(last);
            connect(last); // reconexión automática al último Mac usado
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        startDiscovery();
        acquireWifiLock();
        if (showingControl) hideSystemBars();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        stopDiscovery();
        releaseWifiLock();
        if (web != null) web.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && showingControl) hideSystemBars();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && showingControl) {
            showSetup("Desconectado. Elige un Mac o escribe su IP.");
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ───────────────────────── Superficie (WebView) ─────────────────────────

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(11, 13, 16));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        web.addJavascriptInterface(new NativeBridge(), "NanoNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    showSetup("Se perdió la conexión con " + prefs.getString("host", "") +
                            " (" + err.getDescription() + ").\n¿Sigue abierta la ventana de Nano Control en el Mac?");
                }
            }
        });
        web.setVisibility(View.GONE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Expuesto a JavaScript como window.NanoNative */
    private class NativeBridge {
        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK));
            } else {
                v.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 50)), 120));
            }
        }

        @JavascriptInterface
        public void disconnect() {
            ui.post(() -> showSetup("Desconectado. Elige un Mac o escribe su IP."));
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }

    private void connect(String hostPort) {
        String hp = normalizeHost(hostPort);
        if (hp == null) {
            statusText.setText("Escribe la IP del Mac, por ejemplo 192.168.1.20");
            return;
        }
        prefs.edit().putString("host", hp).apply();
        hostField.setText(hp);
        statusText.setTextColor(Color.rgb(25, 195, 255));
        statusText.setText("Conectando con " + hp + "…");
        final int attempt = ++connectAttempt;
        // Comprobamos primero que el Mac responde: así no hay pantalla negra y sabemos el motivo si falla
        new Thread(() -> {
            String error = probe(hp);
            ui.post(() -> {
                if (attempt != connectAttempt) return; // el usuario ya eligió otro Mac
                if (error == null) openControl(hp);
                else {
                    statusText.setTextColor(Color.rgb(255, 194, 26));
                    statusText.setText(error);
                }
            });
        }, "nano-probe").start();
    }

    private int connectAttempt = 0;

    /** Devuelve null si el puente responde, o una explicación en lenguaje claro si no. */
    private String probe(String hp) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://" + hp + "/manifest.webmanifest").openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setUseCaches(false);
            int code = c.getResponseCode();
            if (code == 200) return null;
            return "El Mac respondió, pero no es Nano Control (código " + code + "). ¿El puerto es el 7777?";
        } catch (ConnectException e) {
            return "✖ El Mac " + hp + " rechazó la conexión.\n\n"
                    + "• ¿Está abierta la ventana de Terminal de «Iniciar Nano Control» y dice «puente listo»?\n"
                    + "• Revisa que el número después de «:» sea 7777.";
        } catch (SocketTimeoutException | NoRouteToHostException e) {
            return "✖ No hay respuesta de " + hp + ".\n\n"
                    + "• El móvil y el Mac deben estar en la MISMA red Wi‑Fi (no datos móviles ni red de invitados).\n"
                    + "• Usa la IP exacta que muestra la ventana de Terminal del Mac.\n"
                    + "• Firewall del Mac: Ajustes del Sistema → Red → Cortafuegos → Opciones → permite «node».";
        } catch (UnknownHostException e) {
            return "✖ La dirección «" + hp + "» no es válida. Escribe la IP que muestra el Mac, por ejemplo 192.168.1.20";
        } catch (Exception e) {
            return "✖ No se pudo conectar con " + hp + ": " + e.getClass().getSimpleName() + " " + e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void openControl(String hp) {
        statusText.setText("");
        showingControl = true;
        setupView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl("http://" + hp + "/");
        web.requestFocus();
        hideSystemBars();
    }

    private void showSetup(String message) {
        showingControl = false;
        web.loadUrl("about:blank");
        web.setVisibility(View.GONE);
        setupView.setVisibility(View.VISIBLE);
        statusText.setTextColor(Color.rgb(255, 194, 26));
        statusText.setText(message);
        showSystemBars();
    }

    private static String normalizeHost(String in) {
        if (in == null) return null;
        String s = in.trim().replace("http://", "").replace("https://", "");
        int slash = s.indexOf('/');
        if (slash >= 0) s = s.substring(0, slash);
        if (s.isEmpty()) return null;
        if (!s.contains(":")) s = s + ":" + DEFAULT_PORT;
        return s;
    }

    // ───────────────────────── Pantalla de conexión ─────────────────────────

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private GradientDrawable rounded(int color, int strokeColor) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(10));
        if (strokeColor != 0) g.setStroke(dp(1), strokeColor);
        return g;
    }

    private Button bigButton(String text, boolean primary) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTextColor(primary ? Color.BLACK : Color.WHITE);
        b.setBackground(rounded(primary ? Color.rgb(25, 195, 255) : Color.rgb(30, 35, 43), primary ? 0 : Color.rgb(42, 48, 58)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    private View buildSetupView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(24);
        col.setPadding(pad, pad, pad, pad);
        scroll.addView(col);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(
                Math.min(dp(440), Math.min(getResources().getDisplayMetrics().widthPixels,
                        getResources().getDisplayMetrics().heightPixels) - dp(48)),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        boxLp.gravity = Gravity.CENTER_HORIZONTAL;
        box.setLayoutParams(boxLp);
        col.addView(box);

        TextView title = new TextView(this);
        title.setText("🎛️  Nano Control");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Abre «Iniciar Nano Control» en tu Mac. Aparecerá aquí automáticamente si estáis en la misma red.");
        sub.setTextColor(Color.rgb(127, 136, 150));
        sub.setTextSize(14);
        sub.setPadding(0, dp(6), 0, dp(14));
        box.addView(sub);

        TextView h1 = new TextView(this);
        h1.setText("MACS ENCONTRADOS");
        h1.setTextColor(Color.rgb(127, 136, 150));
        h1.setTextSize(11);
        box.addView(h1);

        foundList = new LinearLayout(this);
        foundList.setOrientation(LinearLayout.VERTICAL);
        box.addView(foundList);
        renderFound();

        TextView h2 = new TextView(this);
        h2.setText("O ESCRIBE LA DIRECCIÓN QUE MUESTRA EL MAC");
        h2.setTextColor(Color.rgb(127, 136, 150));
        h2.setTextSize(11);
        h2.setPadding(0, dp(20), 0, 0);
        box.addView(h2);

        hostField = new EditText(this);
        hostField.setHint("192.168.1.20:7777");
        hostField.setHintTextColor(Color.rgb(75, 82, 96));
        hostField.setTextColor(Color.WHITE);
        hostField.setSingleLine(true);
        hostField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        hostField.setImeOptions(EditorInfo.IME_ACTION_GO);
        hostField.setBackground(rounded(Color.rgb(22, 26, 32), Color.rgb(42, 48, 58)));
        hostField.setPadding(dp(14), 0, dp(14), 0);
        LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        flp.topMargin = dp(8);
        hostField.setLayoutParams(flp);
        hostField.setOnEditorActionListener((v, actionId, e) -> {
            connect(hostField.getText().toString());
            return true;
        });
        box.addView(hostField);

        Button go = bigButton("Conectar", true);
        go.setOnClickListener(v -> connect(hostField.getText().toString()));
        box.addView(go);

        statusText = new TextView(this);
        statusText.setTextColor(Color.rgb(255, 194, 26));
        statusText.setTextSize(14);
        statusText.setPadding(0, dp(14), 0, 0);
        box.addView(statusText);

        TextView tip = new TextView(this);
        tip.setText("Consejo: para la mínima latencia conecta el móvil al Mac por USB y activa «Anclaje USB».");
        tip.setTextColor(Color.rgb(127, 136, 150));
        tip.setTextSize(12);
        tip.setPadding(0, dp(18), 0, 0);
        box.addView(tip);
        return scroll;
    }

    private void renderFound() {
        foundList.removeAllViews();
        if (found.isEmpty()) {
            TextView t = new TextView(this);
            t.setText("Buscando…");
            t.setTextColor(Color.rgb(75, 82, 96));
            t.setPadding(0, dp(10), 0, 0);
            foundList.addView(t);
            return;
        }
        for (Map.Entry<String, String> e : found.entrySet()) {
            Button b = bigButton(e.getKey() + "\n" + e.getValue(), false);
            b.getLayoutParams().height = dp(64);
            final String hp = e.getValue();
            b.setOnClickListener(v -> connect(hp));
            foundList.addView(b);
        }
    }

    // ───────────────────────── Descubrimiento Bonjour (NSD) ─────────────────────────

    private void startDiscovery() {
        if (discovery != null) return;
        nsd = (NsdManager) getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return;
        discovery = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) {}
            @Override public void onDiscoveryStopped(String type) {}
            @Override public void onStartDiscoveryFailed(String type, int code) { discovery = null; }
            @Override public void onStopDiscoveryFailed(String type, int code) {}

            @Override
            public void onServiceFound(NsdServiceInfo info) {
                ui.post(() -> {
                    resolveQueue.add(info);
                    resolveNext();
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) {
                ui.post(() -> {
                    found.remove(info.getServiceName());
                    renderFound();
                });
            }
        };
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery);
        } catch (Exception e) {
            discovery = null;
        }
    }

    private void stopDiscovery() {
        if (nsd != null && discovery != null) {
            try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
        }
        discovery = null;
        resolveQueue.clear();
        resolving = false;
    }

    /** NsdManager solo resuelve un servicio a la vez en Android antiguos: cola. */
    @SuppressWarnings("deprecation")
    private void resolveNext() {
        if (resolving || resolveQueue.isEmpty() || nsd == null) return;
        resolving = true;
        NsdServiceInfo info = resolveQueue.poll();
        nsd.resolveService(info, new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo si, int code) {
                ui.post(() -> { resolving = false; resolveNext(); });
            }

            @Override
            public void onServiceResolved(NsdServiceInfo si) {
                String host = null;
                // 1) IP anunciada por el puente en el registro TXT (la primera IPv4 del Mac)
                Map<String, byte[]> attrs = si.getAttributes();
                if (attrs != null && attrs.get("ip") != null) {
                    String ips = new String(attrs.get("ip"), StandardCharsets.UTF_8);
                    if (!ips.isEmpty()) host = ips.split(",")[0].trim();
                }
                // 2) Dirección resuelta por mDNS (preferimos IPv4)
                InetAddress a = si.getHost();
                if (a instanceof Inet4Address) host = a.getHostAddress();
                if (host == null && a != null) host = a.getHostAddress();
                final String hp = host == null ? null : host + ":" + si.getPort();
                final String name = si.getServiceName();
                ui.post(() -> {
                    resolving = false;
                    if (hp != null) {
                        found.put(name, hp);
                        renderFound();
                    }
                    resolveNext();
                });
            }
        });
    }

    // ───────────────────────── Red de baja latencia y pantalla completa ─────────────────────────

    @SuppressWarnings("deprecation")
    private void acquireWifiLock() {
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) return;
        if (wifiLock == null) {
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "nano:lowlatency");
            wifiLock.setReferenceCounted(false);
        }
        if (multicastLock == null) {
            multicastLock = wm.createMulticastLock("nano:mdns");
            multicastLock.setReferenceCounted(false);
        }
        try { wifiLock.acquire(); } catch (Exception ignored) {}
        try { multicastLock.acquire(); } catch (Exception ignored) {}
    }

    private void releaseWifiLock() {
        try { if (wifiLock != null) wifiLock.release(); } catch (Exception ignored) {}
        try { if (multicastLock != null) multicastLock.release(); } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @SuppressWarnings("deprecation")
    private void showSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }
}
