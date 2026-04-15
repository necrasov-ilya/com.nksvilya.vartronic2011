Vartronic for Homey Pro

This app integrates VARMANN Vartronic convectors with Homey Pro over Modbus TCP.

Highlights:
- local-only LAN integration for Homey Pro
- shared Modbus TCP gateway transport with serialized requests
- manual pairing for a gateway plus Modbus ID range
- thermostat-style device UI with mode, fan mode, alarm, and resync flows

Before installing:
- verify the gateway host, port, and Modbus IDs
- confirm the deployed TimeLan value on the controllers
- run `npm run build` before `homey app run` or `homey app install`

This repository keeps Homey Compose data in `.homeycompose/` and TypeScript sources in `src/`.
