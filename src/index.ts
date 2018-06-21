import 'source-map-support/register'

import {Token} from 'simple-oauth2';
import {Config} from './config';
import * as express from 'express';
import * as bodyParser from 'body-parser'
import * as cookieParser from 'cookie-parser'
import * as session from 'express-session'
import * as fetch from 'node-fetch'
import {Auth} from './auth';
import * as outlook from 'node-outlook'
import {Scheduler} from './scheduler';
import {Calendar} from './calendar';
import { Log } from 'bblog';
import { ConsoleLogStream } from 'bblog-stream-console';
import * as os from 'os';

const CALENDAR_REFRESH_INTERVAL_MS = 1.8e+6;

const log = Log.createLogger({
    name: 'office-aircon-scheduler',
    hostname: os.hostname(),
    streams: [ new ConsoleLogStream(Log.TRACE) ]
});

const timezone = 'New Zealand Standard Time';
const auth = new Auth(log.child({system: 'auth'}));
const calendars = Config.calendar.rooms.map(room => new Calendar(auth, room.email, timezone));
const scheduler = new Scheduler(log.child({system: 'schedule'}));

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
    secret: Config.app.secret,
    resave: false,
    saveUninitialized: false 
}));

async function reschedule() {
    try {
        for(const calendar of calendars) {
            await scheduler.schedule(calendar);
        }
    } catch (e) {
        log.error(e, 'An error occured');
    }
}

async function beginScheduling() {
    outlook.base.setApiEndpoint('https://outlook.office.com/api/v2.0');
    outlook.base.setAnchorMailbox(auth.getEmail());
    outlook.base.setPreferredTimeZone(timezone);

    await reschedule();
    setInterval(reschedule, CALENDAR_REFRESH_INTERVAL_MS);
}

//async function onExit() {
//    await scheduler.disconnect();
//    await log.close();
//}

app.get('/authorize', async function (req, res) {
    const authCode = req.query.code;

    try {
        await auth.authenticate(authCode);
        await beginScheduling();
    } catch(e) {
        log.error(e, 'An error occured');
    }
});

const server = app.listen(3000, async function() {
    const host = server.address().address;
    const port = server.address().port;

    log.info({status: 'finish', host, port}, 'Express server started');

    const authenticated = await auth.attemptStoredAuth();
    if(authenticated) {
        try {
            await beginScheduling();
        } catch(e) {
            log.error(e, 'An error occured');
        }
    } else {
        log.info({url: auth.getLoginURL()}, 'Visit link to authenticate');
    }
});

//process.on('exit', onExit);     // Safe exit
//process.on('SIGINT', onExit);   // CTRL+C
//process.on('SIGUSR1', onExit);  // "kill pid" (for example: nodemon restart)
//process.on('SIGUSR2', onExit);  // "kill pid" (for example: nodemon restart)
//process.on('uncaughtException', onExit); // Uncaught exception

