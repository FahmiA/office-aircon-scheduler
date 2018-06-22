# Office Aircon Scheduler

A NodeJS server which connects to an Office 365 calender and schedules the office air conditioners over MQTT.

## Configuration

Create a `.env` file with your settings.

```dosini
# Outlook App config
APP_CLIENT_ID=""
APP_CLIENT_SECRET=""
APP_SECRET=""

# MQTT config
MQTT_SERVER="URL:PORT"
MQTT_USER=""
MQTT_PASSWORD=""
MQTT_CLIENT_ID="office-aircon-scheduler
```

Create a `aircon.config.json` file with your scheduling settings:

```json
{
    "rooms": [
        {
            "name": "ROOM_NAME",
            "email": "ROOM_EMAIL",
            "airconId": "ID",
            "disabled": false
        }
    ]
}
```

## Build

```bash
yarn install
yarn run build
```

## Run

```bash
yarn global add bunyan # Pretty-print logs (optional)
yarn start | tee log.json | bunyan -o short
```