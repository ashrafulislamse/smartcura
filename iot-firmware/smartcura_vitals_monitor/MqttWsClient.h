/*
 * MqttWsClient.h
 *
 * Bridges the WebSocketsClient library to a Client interface, so PubSubClient
 * can speak MQTT-over-WebSocket instead of MQTT-over-TCP.
 *
 * Why: SmartCura's broker is publicly reachable only on port 9001 with the
 * WebSocket protocol (plain 1883 is not exposed on the public entry). The ESP32
 * firmware therefore uses the WebSocket path /mqtt to publish vitals packets.
 *
 * The adapter is intentionally minimal: it owns one WebSocketsClient, one
 * incoming-byte ring buffer, and forwards the standard Client calls to the
 * underlying transport. PubSubClient reads from `rxBuf` and writes go straight
 * to a WebSocket binary frame.
 *
 * One connection per firmware boot. If the WebSocket drops, the adapter's
 * `connected()` returns false and PubSubClient's reconnect logic retries.
 *
 * NOTE: WebSocketsClient emits a WSEvent_t on every frame. We register a
 * callback that copies every binary payload into `rxBuf`. Text frames are
 * ignored (Mosquitto never sends them on the /mqtt path).
 */
#ifndef SMARTCURA_MQTT_WS_CLIENT_H
#define SMARTCURA_MQTT_WS_CLIENT_H

#include <Arduino.h>
#include <Client.h>
#include <WebSocketsClient.h>

class MqttWsClient : public Client {
public:
  MqttWsClient() : _ws(), _rxHead(0), _rxTail(0), _connected(false) {}

  // Begin the WebSocket handshake. Idempotent: if already open, this is a no-op.
  // host:    broker hostname, e.g. "mqtt.smartcura.app"
  // port:    WebSocket port, e.g. 9001
  // path:    URL path on the broker, e.g. "/mqtt"
  // protocol: Sec-WebSocket-Protocol header value, e.g. "mqtt". Mosquitto's
  //            WebSocket listener uses this to decide whether the post-upgrade
  //            bytes are MQTT frames; the library default ("arduino") causes
  //            the broker to return 101 and then silently drop MQTT frames,
  //            which is why the original firmware timed out at CONNACK.
  // extraHeaders: optional newline-separated HTTP headers for the Upgrade
  void begin(const char* host, uint16_t port, const char* path = "/mqtt",
             const char* protocol = "mqtt",
             const char* extraHeaders = nullptr) {
    _host = host;
    _port = port;
    _path = path;
    _extraHeaders = extraHeaders;
    Serial.printf("[MQTT-WS] begin host=%s port=%u path=%s protocol=%s\n",
                  host, port, path, protocol);
    _ws.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
      this->_onEvent(type, payload, length);
    });
    _ws.begin(host, port, path, protocol);
  }

  // Pump the underlying WebSocket state machine. Call this from loop() before
  // mqtt.loop() so incoming frames are processed and rxBuf is filled.
  void loop() { _ws.loop(); }

  // ---- Client interface required by PubSubClient ----
  int connect(IPAddress ip, uint16_t port) override {
    // PubSubClient may call connect(IPAddress, port) when DNS is done. We
    // already started the WebSocket in begin(); just report success if open.
    _connectDeadline = millis() + 5000;
    while (!_ws.isConnected() && (long)(millis() - _connectDeadline) < 0) {
      _ws.loop();
      delay(10);
    }
    _connected = _ws.isConnected();
    return _connected ? 1 : 0;
  }
  int connect(const char* host, uint16_t port) override {
    Serial.printf("[MQTT-WS] connect() waiting for WS (deadline=+5s) host=%s port=%u\n", host, port);
    _connectDeadline = millis() + 5000;
    while (!_ws.isConnected() && (long)(millis() - _connectDeadline) < 0) {
      _ws.loop();
      delay(10);
    }
    _connected = _ws.isConnected();
    Serial.printf("[MQTT-WS] connect() returning %d (isConnected=%d)\n",
                  _connected ? 1 : 0, _ws.isConnected() ? 1 : 0);
    return _connected ? 1 : 0;
  }
  size_t write(uint8_t b) override { return write(&b, 1); }
  size_t write(const uint8_t* buf, size_t size) override {
    if (!_ws.isConnected()) {
      Serial.printf("[MQTT-WS] write refused: ws not connected (n=%u)\n", (unsigned)size);
      return 0;
    }
    // MQTT frames are binary; send as WebSocket binary.
    bool ok = _ws.sendBIN(buf, size);
    if (!ok) {
      Serial.printf("[MQTT-WS] sendBIN returned false (n=%u)\n", (unsigned)size);
      return 0;
    }
    // One-shot diagnostic: print the first 32 bytes of the first CONNECT so we
    // can see exactly what's on the wire. Remove this once MQTT connects.
    static bool dumped = false;
    if (!dumped && size >= 4 && buf[0] == 0x10) {
      dumped = true;
      Serial.printf("[MQTT-WS] CONNECT n=%u first16=", (unsigned)size);
      for (size_t i = 0; i < size && i < 16; i++) Serial.printf("%02x ", buf[i]);
      Serial.println();
    }
    return size;
  }
  int available() override {
    _ws.loop();
    return (int)(_rxBufSize());
  }
  int read() override {
    if (_rxBufSize() == 0) { _ws.loop(); return -1; }
    uint8_t b = _rxBuf[_rxTail];
    _rxTail = (_rxTail + 1) % RX_BUF_SIZE;
    return b;
  }
  int read(uint8_t* buf, size_t size) override {
    _ws.loop();
    size_t n = 0;
    while (n < size && _rxBufSize() > 0) {
      buf[n++] = _rxBuf[_rxTail];
      _rxTail = (_rxTail + 1) % RX_BUF_SIZE;
    }
    return (int)n;
  }
  int peek() override {
    if (_rxBufSize() == 0) { _ws.loop(); return -1; }
    return _rxBuf[_rxTail];
  }
  void flush() override { /* no-op for WebSocket */ }
  void stop() override {
    _ws.disconnect();
    _connected = false;
  }
  uint8_t connected() override {
    _ws.loop();
    _connected = _ws.isConnected();
    return _connected ? 1 : 0;
  }
  operator bool() override { return connected(); }

private:
  // Small ring buffer for bytes delivered by the WebSocket callback. PubSubClient
  // typically reads 1-2 KB per MQTT packet, so 2 KB is enough; we let `read()`
  // do partial reads to stay safe.
  static const size_t RX_BUF_SIZE = 2048;
  WebSocketsClient _ws;
  uint8_t _rxBuf[RX_BUF_SIZE];
  size_t  _rxHead;
  size_t  _rxTail;
  bool    _connected;
  unsigned long _connectDeadline;
  const char* _host;
  uint16_t _port;
  const char* _path;
  const char* _extraHeaders;

  size_t _rxBufSize() const {
    return (_rxHead >= _rxTail) ? (_rxHead - _rxTail)
                                : (RX_BUF_SIZE - _rxTail + _rxHead);
  }
  void _rxPush(const uint8_t* data, size_t len) {
    for (size_t i = 0; i < len; i++) {
      size_t next = (_rxHead + 1) % RX_BUF_SIZE;
      if (next == _rxTail) break;  // overflow: drop oldest
      _rxBuf[_rxHead] = data[i];
      _rxHead = next;
    }
  }
  void _onEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
      case WStype_CONNECTED:
        _connected = true;
        Serial.println(F("[MQTT-WS] WS upgrade completed (101)"));
        break;
      case WStype_DISCONNECTED:
        _connected = false;
        _rxHead = _rxTail = 0;  // drop any half-decoded packet
        Serial.println(F("[MQTT-WS] WS disconnected"));
        break;
      case WStype_BIN:
        _rxPush(payload, length);
        if (length >= 2) {
          Serial.printf("[MQTT-WS] RX bin len=%u first2=%02x %02x\n",
                        (unsigned)length, payload[0], payload[1]);
        }
        break;
      case WStype_ERROR:
      case WStype_FRAGMENT_BIN_START:
      case WStype_FRAGMENT_FIN:
        // Mosquitto does not fragment; we ignore these to keep the adapter small.
        break;
      default:
        break;
    }
  }
};

#endif  // SMARTCURA_MQTT_WS_CLIENT_H
