import * as dotenv from 'dotenv'
import * as fs from 'fs';

export interface CalendarConfig {
    rooms: {
        name: string;
        email: string;
        airconId: string | number;
        disabled?:boolean;
    }[];
}


dotenv.config()

const calendarConfigPath = 'aircon.config.json';
if(!fs.existsSync(calendarConfigPath)) {
    console.error(`Calendar config not found in: ${calendarConfigPath}`);
    process.exit(1);
}

const calendarConfig = JSON.parse(fs.readFileSync('aircon.config.json').toString()) as CalendarConfig;
calendarConfig.rooms = calendarConfig.rooms.filter(room => !room.disabled);

export const Config = {
    app: {
        clientId: process.env.APP_CLIENT_ID,
        clientSecret: process.env.APP_CLIENT_SECRET,
        secret: process.env.APP_SECRET, // TODO: What is this?
    },
    mqtt: {
        server: process.env.MQTT_SERVER,
        user: process.env.MQTT_USER,
        password: process.env.MQTT_PASSWORD,
        clientId: process.env.MQTT_CLIENT_ID
    },
    calendar: calendarConfig
};
