#!/usr/bin/env python3
"""Second BLE client verification for SmartCura provisioning service."""
import asyncio
from bleak import BleakScanner, BleakClient

TARGET_NAME = "SmartCura-2272"
PROV_SERVICE = "5c40a76e-8749-4df4-909b-b0e812ea8554"

CHARS = {
    "device_id": "ab8ea1c7-88be-4413-91c8-e6553b5ab52e",
    "pin_verify": "f973817e-61dc-4c80-a927-0448bf543acd",
    "wifi_ssid": "3190b9cd-77de-4707-be59-689c5e82639a",
    "wifi_password": "6f7d24de-a412-4daa-8afd-fb38d6ffb045",
    "status": "657bd447-0431-4946-a11b-09e66f8a9a30",
    "command": "e36d4e43-3b24-4083-9837-17b0dae3ceb0",
}


def decode_properties(props: int) -> str:
    names = []
    if props & 0x01:
        names.append("BROADCAST")
    if props & 0x02:
        names.append("READ")
    if props & 0x04:
        names.append("WRITE_NO_RESPONSE")
    if props & 0x08:
        names.append("WRITE")
    if props & 0x10:
        names.append("NOTIFY")
    if props & 0x20:
        names.append("INDICATE")
    if props & 0x40:
        names.append("AUTH_SIGNED_WRITE")
    if props & 0x80:
        names.append("EXTENDED")
    return " | ".join(names) if names else "NONE"


async def main():
    print("[BLE] scanning for SmartCura devices...")
    devices = await BleakScanner.discover(timeout=10.0)
    target = None
    for d in devices:
        name = d.name or ""
        print(f"  found: {name} @ {d.address}")
        if name == TARGET_NAME:
            target = d
            break

    if target is None:
        print(f"[BLE] ERROR: {TARGET_NAME} not found")
        return

    print(f"[BLE] connecting to {TARGET_NAME} @ {target.address}...")
    async with BleakClient(target.address, timeout=20.0) as client:
        print(f"[BLE] connected: {client.is_connected}")
        services = await client.get_services()
        prov = services.get_service(PROV_SERVICE)
        if prov is None:
            print(f"[BLE] ERROR: provisioning service {PROV_SERVICE} not found")
            return

        print(f"[BLE] provisioning service found: {prov.uuid}")
        for label, uuid in CHARS.items():
            char = prov.get_characteristic(uuid)
            if char is None:
                print(f"[BLE] {label}: NOT FOUND")
                continue
            props = char.properties
            print(f"[BLE] {label}: handle={char.handle} props=0x{props:04x} ({decode_properties(props)})")
            if "read" in char.properties.name:
                try:
                    value = await client.read_gatt_char(char)
                    print(f"[BLE] {label} value: {value}")
                except Exception as e:
                    print(f"[BLE] {label} read error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
