package __PACKAGE__

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.DatagramSocket
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.UUID
import org.json.JSONObject

class PlusDiscoveryPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PlusDiscovery(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

@Suppress("DEPRECATION")
class PlusDiscovery(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PlusDiscovery"
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private var listener: NsdManager.DiscoveryListener? = null
  private var lock: WifiManager.MulticastLock? = null
  @Volatile private var socket: DatagramSocket? = null
  @Volatile private var generation = 0
  private val resolveQueue = java.util.concurrent.ConcurrentLinkedQueue<NsdServiceInfo>()
  private val resolving = java.util.concurrent.atomic.AtomicBoolean(false)
  private fun emit(name: String, value: WritableMap) {
    if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
  }
  private fun failure(code: String) { val m = Arguments.createMap(); m.putString("error", code); emit("PlusDiscoveryError", m) }
  private fun resolveNext(gen: Int) {
    if (gen != generation || !resolving.compareAndSet(false, true)) return
    val next = resolveQueue.poll()
    if (next == null) { resolving.set(false); return }
    nsd.resolveService(next, object: NsdManager.ResolveListener {
      override fun onResolveFailed(service: NsdServiceInfo, code: Int) { resolving.set(false); resolveNext(gen) }
      override fun onServiceResolved(service: NsdServiceInfo) {
        if (gen == generation) {
          val host = service.host?.hostAddress
          if (host != null && !host.contains(':')) {
            val m = Arguments.createMap(); m.putString("host", host); m.putInt("httpPort", service.port); m.putString("name", service.serviceName); emit("PlusDiscovered", m)
          }
        }
        resolving.set(false); resolveNext(gen)
      }
    })
  }
  @ReactMethod fun start() {
    stop(); val gen = generation
    try {
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      lock = wifi.createMulticastLock("tiez-plus-discovery").apply { setReferenceCounted(false); acquire() }
      listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) {}
        override fun onDiscoveryStopped(type: String) {}
        override fun onStartDiscoveryFailed(type: String, code: Int) { failure("NSD_START_$code") }
        override fun onStopDiscoveryFailed(type: String, code: Int) {}
        override fun onServiceLost(service: NsdServiceInfo) {}
        override fun onServiceFound(service: NsdServiceInfo) {
          if (gen == generation && service.serviceType.contains("_tiezplus._tcp")) { resolveQueue.add(service); resolveNext(gen) }
        }
      }
      nsd.discoverServices("_tiezplus._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: Exception) { failure("NSD_PERMISSION_OR_NETWORK") }
    Thread {
      var local: DatagramSocket? = null
      try {
        local = DatagramSocket().apply { broadcast = true; soTimeout = 1000 }
        if (gen != generation) { local.close(); return@Thread }
        socket = local
        val nonce = UUID.randomUUID().toString()
        val body = JSONObject().put("v", 1).put("type", "tiezplus.discover").put("nonce", nonce).toString().toByteArray()
        var lastSend = 0L
        while (gen == generation) {
          if (System.currentTimeMillis() - lastSend > 5000) {
            val destinations = mutableSetOf(InetAddress.getByName("255.255.255.255"))
            NetworkInterface.getNetworkInterfaces()?.toList()?.filter { it.isUp && !it.isLoopback }?.forEach { net -> net.interfaceAddresses.forEach { address -> address.broadcast?.let { destinations.add(it) } } }
            destinations.forEach { address -> try { local.send(DatagramPacket(body, body.size, address, 18084)) } catch (_: Exception) {} }
            lastSend = System.currentTimeMillis()
          }
          try {
            val packet = DatagramPacket(ByteArray(4096), 4096); local.receive(packet)
            val json = JSONObject(String(packet.data, 0, packet.length))
            if (json.optString("nonce") == nonce && json.optString("product") == "tiez-plus" && gen == generation) {
              val m = Arguments.createMap(); m.putString("host", packet.address.hostAddress); m.putInt("httpPort", json.getInt("httpPort")); m.putString("name", json.optString("name")); emit("PlusDiscovered", m)
            }
          } catch (_: java.net.SocketTimeoutException) {}
        }
      } catch (_: Exception) { if (gen == generation) failure("UDP_UNAVAILABLE") }
      finally { local?.close() }
    }.apply { name = "tiez-plus-discovery"; isDaemon = true }.start()
  }
  @ReactMethod fun stop() {
    generation++
    listener?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }; listener = null
    socket?.close(); socket = null
    lock?.let { if (it.isHeld) it.release() }; lock = null
    resolveQueue.clear(); resolving.set(false)
  }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
  override fun invalidate() { stop(); super.invalidate() }
}
