package com.yaugahaus.plugins.solanamwa;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Bridges Solana Mobile Wallet Adapter for Capacitor Android WebViews.
 *
 * The JS MWA library opens wallets with window.location.assign('solana-wallet://...').
 * That fails inside Capacitor unless we intercept the URI, launch an intent with the
 * right categories, and fire a synthetic blur so the JS association waiter resolves.
 */
@CapacitorPlugin(name = "YaugaSolanaMwa")
public class YaugaSolanaMwaPlugin extends Plugin {
    private static final String TAG = "YaugaSolanaMwa";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url != null && "solana-wallet".equals(url.getScheme())) {
            Log.d(TAG, "Intercepted solana-wallet URI");
            launchWalletIntent(url);
            return true;
        }
        return null;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("solana-wallet:/v1/associate/local"));
        intent.addCategory(Intent.CATEGORY_BROWSABLE);

        List<ResolveInfo> resolvers = getActivity()
            .getPackageManager()
            .queryIntentActivities(intent, 0);

        JSObject ret = new JSObject();
        ret.put("available", !resolvers.isEmpty());
        call.resolve(ret);
    }

    @PluginMethod
    public void launchWalletUri(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("Must provide 'uri' parameter");
            return;
        }
        boolean success = launchWalletIntent(Uri.parse(uri));
        if (!success) {
            call.reject("No MWA-compatible wallet found. Install Phantom, Solflare, or another Solana wallet that supports Mobile Wallet Adapter.");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("launched", true);
        call.resolve(ret);
    }

    private boolean launchWalletIntent(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addCategory(Intent.CATEGORY_DEFAULT);

        try {
            getActivity().startActivity(intent);
            getBridge().eval("window.dispatchEvent(new Event('blur'))", null);
            return true;
        } catch (ActivityNotFoundException e) {
            Log.e(TAG, "No wallet app for " + uri, e);
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch wallet intent", e);
            return false;
        }
    }
}
