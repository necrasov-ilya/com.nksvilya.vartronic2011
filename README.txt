Vartronic for Homey Pro

This app integrates VARMANN Vartronic convectors with Homey Pro over Modbus TCP.

Highlights:
- local-only LAN integration for Homey Pro
- shared Modbus TCP gateway transport with serialized requests
- manual pairing for a gateway plus Modbus ID range
- thermostat-style device UI with mode, fan mode, alarm, and resync flows
- Flow action for writing an external room sensor value to TmpOut (0x0009)

Before installing:
- verify the gateway host, port, and Modbus IDs
- confirm the controllers return a valid TimeLan value
- run `npm run build` before `homey app run` or `homey app install`

External temperature:
- use the "Set external room temperature" Flow action when a room temperature sensor is available in Homey
- the action writes TmpOut (0x0009) as temperature x10, matching Vartronic thermostat mode without an NTC sensor
- accepted values are 1.0 C through 50.0 C and are rounded to 0.1 C

This repository keeps Homey Compose data in `.homeycompose/` and TypeScript sources in `src/`.
