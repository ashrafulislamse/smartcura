# SmartCura IoT Hardware — Priority Shopping List (Malaysia, Aug 2026)

> **Why this list exists.** Your project already has a working ESP32 firmware sketch at `smartcura_vitals_monitor/smartcura_vitals_monitor.ino`. It expects one microcontroller (ESP32) and two sensors (MAX30102 for HR/SpO2, DS18B20 for temperature). The patient app also exposes device cards for a blood-pressure monitor, glucose meter, pulse oximeter, thermometer and weight scale, but only the BP monitor is a realistic clinical-grade purchase for an FYP demo. Everything else is either covered by the MAX30102 or should be entered manually / marked as future work.
>
> **Sources:** Prices are from Malaysian electronics shops (MakerHub, TechMakers, GI Electronic, Cytron) and pharmacy listings for the Omron. These are the same sellers on Shopee; Shopee product pages require login and block automated scraping, so direct shop links are used below together with Shopee search links.

---

## SECTION 0 — What Phase 1 Covers (and what it does not)

Your patient app shows cards for six device categories. The Phase 1 prototype already covers **three of them** for free because the sensors are in the ESP32 bundle:

| Patient app card | What Phase 1 gives you | Sensor | Covered? | Price in Phase 1 |
|---|---|---|---|---|
| **Thermometer** | Body temperature (°C) | DS18B20 waterproof probe | **Yes** | Included in bundle |
| **Pulse oximeter** | Blood oxygen SpO₂ (%) | MAX30102 | **Yes** | Included in bundle |
| **Heart rate** | Heart rate BPM | MAX30102 | **Yes** | Included in bundle |
| **Blood pressure** | Systolic / diastolic | None | No | See Section 2 |
| **Glucose meter** | Blood glucose | None | No | See Section 4D |
| **Weight scale** | Body weight | None | No | See below |

**So if you buy only Phase 1, you can demo:** temperature, heart rate, and SpO₂ from one ESP32 device. That is already a complete FYP demo path. Blood pressure, weight, and glucose are extras you can add later or skip.

---

## SECTION 1 — REQUIRED: Phase 1 Prototype (buy first, ~RM46)

Order these together from one shop to save shipping. This is the minimum hardware that makes `smartcura_vitals_monitor.ino` produce real numbers on the Serial Monitor.

| Priority | Item | Exact spec | Why required | Price (RM) | Buy link |
|---|---|---|---|---|---|
| 1 | **ESP32 board** | NodeMCU ESP32 / ESP-WROOM-32 / DOIT DEVKIT V1, 30 or 38 pin, CP2102 or CH340. 38-pin gives more GPIO. | The `.ino` is written for ESP32 and uses GPIO 21 (SDA), GPIO 22 (SCL) and GPIO 4 (1-Wire). | **8.90 – 29.95** (cheapest CH340 variant ~RM8.90; CP2102 ~RM12–15) | [MakerHub NodeMCU ESP32](https://makerhub.my/shop/microcontroller/nodemcu-esp32-wi-fi-bluetooth-development-board-ch340-cp2012-for-iot-project/) / [TechMakers ESP32](https://techmakers.com.my/esp32-ultra-low-power-consumption-dual-core-wifi-bluetooth-development-board) / [GI Electronic NodeMCU ESP32](https://www.gie.com.my/shop.php?action=wireless%2Fwifi%2Fesp32) |
| 2 | **MAX30102 module** | GY-MAX30102, **not** MAX30100. 6-pin I2C breakout. | Firmware reads HR and SpO2 from this sensor via `Wire.begin(21,22)`. | **9.30 – 10.80** | [GI Electronic MAX30102](https://www.gie.com.my/shop.php?action=sensors%2Flight_ir%2FMAX30102) / [MakerHub MAX30102](https://makerhub.my/shop/sensor/blood-oxygen-sensor-max30102-pulse-sensor-heart-rate-oxymeter-sensor-module/) / [TechMakers MAX30102](https://shop.techmakers.com.my/max30102-pulse-oximeter-and-heart-rate-sensor) |
| 3 | **DS18B20 waterproof probe** | Stainless steel tube, 1 m cable, 3-wire. | Firmware reads temperature via `DallasTemperature` on GPIO 4. | **4.95** | [MakerHub DS18B20](https://makerhub.my/shop/sensor/temperature-sensor-ds18b20-temperature-measurement-probe-waterproof-18b20/) |
| 4 | **MB-102 breadboard + jumper wires** | MB-102 830-point solderless breadboard + 40–65 pcs male-male jumper wires. | Needed to wire ESP32 → MAX30102 → DS18B20 without soldering. | **10.00** (bundle) | [TechMakers MB-102 bundle](https://techmakers.com.my/mb-102-power-supply-module-with-breadboard-set) / [MakerHub jumper wires](https://makerhub.my/shop/electrical/breadborad-jumper-wire-set-male-to-male-bread-board-wire-solderless-connection/) |
| 5 | **Resistor** | 4.7 kΩ 1/4 W metal film (or a 400-pcs assorted kit). | The DS18B20 data line needs a 4.7 kΩ pull-up between GPIO 4 and 3.3 V. | **1.00** for a few pieces; **7.95** for 400-pcs kit | [MakerHub 400-pcs resistor kit](https://makerhub.my/shop/electrical/400-pcs-1-4w-resistor-pack-resistor-kit-20-common-value-with-20-each/) |

**Phase 1 subtotal:** ~RM 34.15 if you buy the cheapest single items; ~RM 42.60 if you buy the 400-pcs resistor kit and a mid-range ESP32. Add ~RM 5–10 shipping.

**What Phase 1 produces:** `{"device":"smartcura-01","hr":75,"spo2":98,"temp_c":36.50,...}` every ~4 seconds on the Serial Monitor. This maps directly to the **Thermometer**, **Pulse Oximeter**, and **Heart Rate** cards in the patient app.

### ⚠️ Phase 1 verification checklist before buying
- ESP32 title says **ESP32**, not ESP8266. Look for `ESP-WROOM-32` or `ESP32S`.
- 30-pin or 38-pin both work; 38-pin recommended.
- USB chip: CP2102 is easier on Windows; CH340 is fine but needs the CH340 driver.
- MAX30102 must say **MAX30102**; avoid MAX30100.
- DS18B20 must be the **waterproof stainless-steel probe** with a ~1 m cable, not the bare TO-92 chip.

---

## SECTION 2 — RECOMMENDED: Phase 2 Clinical Demo (completely optional)

Order this only after you see real HR/SpO2/Temp values on the Serial Monitor and only if you want a fourth vital sign for the demo. A blood-pressure reading makes the FYP demo look more complete because it is a vital the ESP32 sensors cannot measure, but **you can skip this entire section** and still demo HR, SpO2 and temperature from the ESP32.

**If you do not want to buy a BP device, jump straight to Section 5 (budget summary) and treat this as RM 0.**

### Option A — Best clinical accuracy (recommended if budget allows)

| Priority | Item | Exact spec | Why required | Price (RM) | Buy link |
|---|---|---|---|---|---|
| 6 | **Omron blood pressure monitor** | **Omron HEM-7120**, 5-year warranty, cuff 22–32 cm, no AC adapter. | The only FDA/MDA-cleared device in the budget. Readings are displayed on the unit and can be entered manually in the patient app as “manual entry”. | **149 – 175** (pharmacy; Shopee may be lower, but verify warranty) | [HTM Pharmacy RM149](https://htmpharmacy.my/products/omron-blood-pressure-monitor-hem-7120) / [AA Pharmacy](https://aapharmacy.com.my/products/omron-automatic-blood-pressure-monitor-model-hem-7120-5-years-warranty) / [iElder RM179](https://ielder.asia/products/automatic-blood-pressure-monitor-hem-7120) / [Shopee search](https://shopee.com.my/search?keyword=Omron%20HEM-7120) |

### ⚠️ Omron HEM-7120 buying rules
- Model must be **HEM-7120**. HEM-7121 is the same unit with a different cuff size; HEM-7156T/HEM-7361T add Bluetooth but cost RM 200+.
- Confirm “5-year warranty” and genuine Omron Japan.
- Includes main unit, M-size cuff, 4× AA batteries, manual. AC adapter is usually **not** included (batteries are fine for the demo).
- Shopee listings can be cheaper, but check seller rating (≥ 4.8), sold count, and warranty mention to avoid grey-market/counterfeit units.

### Option B — Can’t afford the Omron? Cheaper alternatives

If the Omron is too expensive, pick one of these. The demo is still valid as long as the reading is **real and manually entered** in the app.

| Priority | Alternative | Price (RM) | Pros / Cons | Where to get it |
|---|---|---|---|---|
| 6b.1 | **Free: clinic / pharmacy BP check** | **0** | Most accurate because it is done by a professional or clinic-grade machine. You just take a photo of the reading and enter it manually. | Any clinic, Caring/AA/Watsons pharmacy, or your university health center. |
| 6b.2 | **Free: borrow from family/friend** | **0** | Zero cost if someone already owns an Omron. | Ask a family member or housemate. |
| 6b.3 | **Generic upper-arm automatic BP monitor** (Shopee/Lazada) | **~50 – 70** | Cheapest way to own a device. Quality varies; pick an upper-arm model, not a wrist model. | [Shopee: upper arm BP monitor](https://shopee.com.my/search?keyword=automatic%20upper%20arm%20blood%20pressure%20monitor) / [Lazada BP monitors](https://www.lazada.com.my/shop-blood-pressure-monitors/) |
| 6b.4 | **Kiirana “Blood Pressure Monitor Pro”** (upper arm) | **59** | Promo price, upper-arm design, COD available. Brand is less established than Omron. | [Kiirana Shop](https://kiirana-shop.com/blood-pressure-monitorr-pro) |
| 6b.5 | **Aros LD-562** upper arm | **119** | Pharmacy/medical-supply brand; more reliable than generic unknowns. | [Pro Life Medical](https://www.prolife-medical.com/ourproducts/cid/514129/cat/blood-pressure-monitor/) |
| 6b.6 | **Rossmax Z1** | **165** | 5-year warranty, well-known in Malaysia. Only slightly cheaper than Omron. | [Alpro Pharmacy](https://www.alpropharmacy.com/products/rossmax-blood-pressure-monitor-model-z1-type-c-cable-5-years-warranty) |
| 6b.7 | **Manual aneroid sphygmomanometer + stethoscope** | **~30 – 50** | Cheapest hardware, but requires skill to use and is slower. | Search on Shopee/Lazada for “manual BP set stethoscope” |
| 6b.8 | **Skip BP entirely** | **0** | Demo only HR, SpO2 and temperature from the ESP32. Add a note in your report that BP is planned as a future integration. | No purchase needed. |

**Important:** Avoid **wrist** BP monitors if you can. They are cheaper (RM 40–99) but readings are less consistent and examiners often question them. If you must buy a wrist unit, label it clearly as a *budget reference device*, not a clinical measurement.

**My recommendation:**
- **Do not want to spend anything on BP** → skip it. The ESP32 already gives you real HR, SpO2 and temperature. This is the cheapest and still-valid demo path.
- **Zero budget, but want a BP reading** → use a free clinic/pharmacy check + manual entry.
- **RM 50–70 budget** → buy a generic **upper-arm** automatic monitor on Shopee/Lazada.
- **RM 100–120 budget** → Aros LD-562 or save a bit more for the Omron HEM-7120.

---

## SECTION 3 — REQUIRED: Development / Deployment (non-IoT hardware)

These are not in the firmware folder but are required to run the SmartCura platform you actually built.

| Priority | Item | Why required | Price | Buy link / Notes |
|---|---|---|---|---|
| 7 | **VPS / cloud server** | The backend runs in Docker (`apps/api/docker-compose.yaml` or `compose.prod.yaml`). Coolify panel is already ready per the deployment docs. | RM 20–80/month depending on specs | Your Coolify / VPS provider (choose between Coolify proxy + `docker-compose.yaml`, or standalone `compose.prod.yaml` + Caddy). |
| 8 | **Domain name** | `smartcura.app` and subdomains (`api`, `portal`, `livekit`, `mqtt`) are already referenced in deployment docs. | ~RM 50–80/year | Any domain registrar. |
| 9 | **Android / iOS test devices** | The project has `patient-app`, `doctor-app` and `driver-app`. You need at least one physical phone for push notifications, Bluetooth/WiFi pairing, and camera/video testing. | Use existing phones if possible | If buying, a budget Android (e.g., used/refurbished Xiaomi/Redmi) is the cheapest test platform. |

---

## SECTION 4 — OPTIONAL: Future / Nice-to-Have (buy only if budget left)

| Priority | Item | Why optional | Price (RM) | Buy link |
|---|---|---|---|---|
| A | **AD8232 ECG module** | Adds a live ECG waveform, but it is noisy, not medical-grade, and the firmware does not use it yet. | **3.50 – 24.50** | [Sainapse AD8232](https://www.sainapse.com.my/sensor/ad8232-ecg-heart-pulse-rate-monitor-sensor-module-with-body-sensor-pad) / [TechMakers AD8232](https://www.techmakers.com.my/ad8232-ecg-heartbeat-measurement-monitor) |
| B | **0.91–0.96 inch OLED display** | Lets the device show readings without a laptop. Firmware currently prints to Serial Monitor only. | **7.95 – 18.00** | [MakerHub 0.91″ OLED](https://makerhub.my/shop/display/0-91-oled-display-module-i2c-communication-3-3v-5v-for-arduino-iot-application/) / [QQ Trading 0.96″ OLED](https://qqtrading.com.my/0-96-inch-oled-screen-128x64px-i2c-interface) |
| C | **18650 battery + TP4056 charger / battery shield** | Makes the prototype portable. USB power from a laptop is enough for testing. | **15.00 – 30.00** (charger ~RM 2–5; shield ~RM 16–20) | [MakerHub TP4056 charger](https://makerhub.my/shop/breakout/tp4056-18650-battery-charger-module-lithium-ion-battery-li-ion-battery-charger-type-c-micro-usb-charging-module/) / [MakerHub dual 18650 shield](https://makerhub.my/shop/shield/dual-18650-lithium-battery-holder-shield-v3-power-module-5v-usb-3v-pin-output-charging/) / [Robotronik 18650 shield](https://robotronik.com.my/portable-mobile-power-18650-battery-shield) |
| D | **Accu-Chek glucose meter** | The app has a glucose-meter card, but there is no firmware or API integration yet. Use manual entry for the demo. | **80.00 – 115.00** (meter + strips) | [iElder Accu-Chek Instant S RM80](https://ielder.asia/products/accu-chek-instant-meter) / [AA Pharmacy glucose monitors](https://aapharmacy.com.my/collections/blood-glucose-monitors) |
| E | **Dedicated pulse oximeter** | MAX30102 already provides SpO2; buy this only as a reference to validate accuracy. | **50.00 – 110.00** | Skip unless you need a clinical reference. |
| F | **37-in-1 sensor kit** | Not recommended. Its “heartbeat sensor” is a KY-039 that cannot do SpO2. Buy MAX30102 separately. | **~60.00** | Do not buy. |

---

## SECTION 5 — Total Budget Summary

| Phase | Items | Budget (RM) |
|---|---|---|
| **Phase 1 (prototype)** | ESP32 + MAX30102 + DS18B20 + breadboard + 4.7 kΩ resistor | **~RM 40 – 50** |
| **Minimum demo (Phase 1 + weight scale)** | Adds a real weight reading for the Weight Scale card | **~RM 60 – 70** |
| **Still-cheap demo (add BP)** | Generic upper-arm BP monitor | **~RM 110 – 140** |
| Phase 2 (clinical demo — optional) | BP monitor or free clinic check | **~RM 0 – 175** |
| **Deployment / dev** | VPS + domain + test phone (use existing phone if possible) | **~RM 70 – 160/year** |
| **Grand total (minimum, no BP)** | | **~RM 110 – 220** |
| **With optional extras** | OLED + battery + ECG + glucose meter | **Add ~RM 100 – 190** |

### Cheapest real-device options for the non-ESP32 categories

| Category | Cheapest realistic option | Price (RM) | Why | Link |
|---|---|---|---|---|
| **Weight scale** | OCTOPUS digital body scale | **~RM 19.90** | Cheapest standalone digital scale; reading entered manually | [Shopee search: digital body scale](https://shopee.com.my/search?keyword=digital%20body%20scale%20OCTOPUS) |
| **Blood pressure** | Generic upper-arm automatic monitor | **~RM 50 – 70** | Cheapest owned device; avoid wrist models | [Shopee search: upper arm BP monitor](https://shopee.com.my/search?keyword=automatic%20upper%20arm%20blood%20pressure%20monitor) |
| **Glucose meter** | Accu-Chek Instant S | **~RM 80** | Cheapest known-brand starter kit; manual entry only | [iElder Accu-Chek Instant S](https://ielder.asia/products/accu-chek-instant-meter) / [Shopee search](https://shopee.com.my/search?keyword=Accu-Chek%20Instant%20S) |
| **Smart watch / band** | Xiaomi Mi Band 6 / Band 7 | **~RM 80 – 140** | Not integrated with firmware; purely for show/manual entry | [Shopee search: Mi Band 7](https://shopee.com.my/search?keyword=Mi%20Band%207) |

---

## SECTION 6 — Shopee Quick-Click Search Links (manual browse)

Because Shopee blocks automated access, use these search links and filter by **“Local”** stock, ≥ 4.8 rating, and 1k+ sold:

- [ESP32 NodeMCU on Shopee](https://shopee.com.my/search?keyword=ESP32%20NodeMCU)
- [MAX30102 on Shopee](https://shopee.com.my/search?keyword=MAX30102)
- [DS18B20 waterproof on Shopee](https://shopee.com.my/search?keyword=DS18B20%20waterproof)
- [MB-102 breadboard + jumper wires on Shopee](https://shopee.com.my/search?keyword=MB-102%20breadboard%20jumper)
- [4.7 kΩ resistor on Shopee](https://shopee.com.my/search?keyword=4.7k%20resistor)
- [Omron HEM-7120 on Shopee](https://shopee.com.my/search?keyword=Omron%20HEM-7120)
- [AD8232 ECG on Shopee](https://shopee.com.my/search?keyword=AD8232)
- [0.96″ OLED on Shopee](https://shopee.com.my/search?keyword=0.96%20OLED%20I2C)
- [18650 battery shield on Shopee](https://shopee.com.my/search?keyword=18650%20battery%20shield%20ESP32)
- [Accu-Chek glucose meter on Shopee](https://shopee.com.my/search?keyword=Accu-Chek%20glucose%20meter)

---

## SECTION 7 — After the parts arrive

1. Wire the breadboard exactly as documented in the top comments of `smartcura_vitals_monitor.ino`:
   - MAX30102: VIN→3.3 V, GND→GND, SDA→GPIO 21, SCL→GPIO 22.
   - DS18B20: RED→3.3 V, BLACK→GND, YELLOW→GPIO 4; add 4.7 kΩ between GPIO 4 and 3.3 V.
2. Install Arduino IDE and the three libraries: SparkFun MAX3010X, OneWire, DallasTemperature.
3. Select board `DOIT ESP32 DEVKIT V1`, upload speed 921600, Serial Monitor 115200 baud.
4. Place a finger on the MAX30102 and hold the DS18B20 probe; you should see JSON lines with `hr`, `spo2`, `temp_c` every ~4 seconds.
5. Once that works, order the Omron HEM-7120. Then wire the ESP32 to WiFi and add the HTTP POST layer so readings flow into the patient app instead of staying on the laptop screen.

---

**Medical disclaimer:** All hardware listed is for prototype / FYP demonstration only. Do not use for diagnosis, treatment, or real patient care without the required engineering, clinical, privacy, security, and regulatory work.
