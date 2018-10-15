import * as schedule from 'node-schedule';
import * as mqtt from 'async-mqtt';
import {Calendar, CalanderEntryDateTime, CalendarEntry, CalendarEntryMaster, isEntryMaster, isEntryInstance, isEntryOccurrence} from './calendar';
import { Log } from 'bblog';
import { Config} from './config';

const MQTT_RETAIN = true;

/** https://github.com/node-schedule/node-schedule */
interface ScheduledEvent {
    id: string;
    entry: CalendarEntry;
    instanceEntry: CalendarEntryMaster;
    start: Date;
    end: Date;
    startJob: schedule.Job;
    endJob: schedule.Job;
}

export class Scheduler {

    private airconCtrls:Map<string, string>;
    private log:Log;
    private mqttClient:mqtt.Client;
    private events: Map<string, ScheduledEvent> = new Map();

    constructor(log:Log) {
        this.log = log;

        this.airconCtrls = new Map<string, string>();
        for(const calendarConfig of Config.calendar.rooms) {
            this.airconCtrls.set(calendarConfig.name, String(calendarConfig.airconId));
        }

        this.mqttClient = mqtt.connect(Config.mqtt.server, {
            username: Config.mqtt.user,
            password: Config.mqtt.password,
            clientId: Config.mqtt.clientId
        });

        this.mqttClient.on('connect', () => log.info('MQTT connected'));
        this.mqttClient.on('reconnect', () => log.info('MQTT reconnecting...'));
        this.mqttClient.on('error', (error) => log.error({error}, 'MQTT connection failed'));
        this.mqttClient.on('offline', () => log.warn('MQTT offline'));
    }

    async disconnect():Promise<void> {
        if(!this.mqttClient.connected) {
            return Promise.resolve();
        }

        await this.mqttClient.end();
        this.log.info('Disconnected from MQTT server');
    }

    async schedule(calendar:Calendar) {
        const entries = await calendar.fetch();
        const now = new Date();

        this.log.info({calendar: calendar.email, count: entries.length}, 'Scheduling calendar entries');

        for(const entry of entries) {
            // Master entries describe their occurrences but are not themselves scheduled
            if(isEntryMaster(entry)) {
                continue;
            }

            // May be same as entry
            const instanceEntry = this.getInstanceEntry(entry, entries);

            if(instanceEntry == null) {
                this.log.error({entry}, 'Skipping entry without instance to describe it');
                continue;
            }

            const entryLog = this.log.child(this.getEventLogInfo(entry, instanceEntry));

            const existingScheduledEvent = this.events.get(entry.Id);
            if(existingScheduledEvent != null && existingScheduledEvent.instanceEntry.ChangeKey === instanceEntry.ChangeKey) {
                continue;
            }

            if(instanceEntry.IsAllDay) {
                this.scheduleAllDayEntry(entry, instanceEntry, entryLog);
                continue;
            }

            if(instanceEntry.IsCancelled) {
                this.scheduleCancelledEntry(entry, instanceEntry, entryLog);
                continue;
            }

            // TODO: Apply timezone
            const start = new Date(entry.Start.DateTime);
            const end = new Date(entry.End.DateTime);
            if(start < now) {
                this.scheduleOutOfRangeEntry(entry, instanceEntry, entryLog);
                continue;
            }

            const airconId = this.getAirconIdForEntry(instanceEntry);
            if(airconId == null) {
                this.scheduleUnsupportedLocationEntry(entry, instanceEntry, entryLog);
                continue;
            }

            const preStart = new Date(start);
            preStart.setMinutes(preStart.getMinutes() - 5);

            if(existingScheduledEvent != null) {
                this.cancelScheduledEntry(entry.Id);
                const scheduledEvent = this.createEvent(entry, instanceEntry, airconId, preStart, end, entryLog);
                entryLog.info('Rescheduled event');
            } else {
                const scheduledEvent = this.createEvent(entry, instanceEntry, airconId, preStart, end, entryLog);
                entryLog.info('Scheduled event');
            }
        }

        this.mergeBackToBackEvents();
    }

    private mergeBackToBackEvents() {
        const sortedEvents = Array.from(this.events.values())
            .sort((event1, event2) => event1.start.getTime() - event2.start.getTime());

        let i = 0;
        while(i < sortedEvents.length) {
            const startEvent = sortedEvents[i];
            const endEventIndex = sortedEvents.findIndex((ev, index) => {
                return index > i && Math.abs(ev.start.getTime() - startEvent.end.getTime()) < 600000;
            });

            if(endEventIndex > i) {
                const backToBackEvents = sortedEvents.slice(i, endEventIndex + 1);
                const infos = backToBackEvents.map(ev => this.getEventLogInfo(ev.entry, ev.instanceEntry));
                this.log.info({events: infos}, 'Found back-to-back events');

                for(const ev of backToBackEvents) {
                    ev.startJob.cancel();
                    ev.endJob.cancel();
                }

                backToBackEvents[0].startJob.schedule(backToBackEvents[0].start);
                backToBackEvents[backToBackEvents.length - 1].endJob.schedule(backToBackEvents[backToBackEvents.length - 1].end);

                i = endEventIndex + 1;
            } else {

                if(startEvent.startJob.nextInvocation() == null) {
                    startEvent.startJob.schedule(startEvent.start);
                }

                if(startEvent.endJob.nextInvocation() == null) {
                    startEvent.endJob.schedule(startEvent.end);
                }

                i += 1;
            }
        }
    }

    private scheduleAllDayEntry(entry:CalendarEntry, instanceEntry:CalendarEntryMaster, log:Log) {
        const scheduledEvent = this.events.get(entry.Id);
        if(scheduledEvent != null) {
            this.cancelScheduledEntry(entry.Id);
            log.info('Unscheduling "all-day" event');
        }

        log.info('Skipping all-day event');
    }

    private scheduleCancelledEntry(entry:CalendarEntry, instanceEntry:CalendarEntryMaster, log:Log) {
        const scheduledEvent = this.events.get(entry.Id);
        if(scheduledEvent != null) {
            this.cancelScheduledEntry(entry.Id);
            log.info('Unscheduling cancelled event');
        }

        log.info('Skipping cancelled event');
    }

    private scheduleOutOfRangeEntry(entry:CalendarEntry, instanceEntry:CalendarEntryMaster, log:Log) {
        const scheduledEvent = this.events.get(entry.Id);
        if(scheduledEvent != null) {
            this.cancelScheduledEntry(entry.Id);
            log.info('Unscheduling past event');
        }

        log.info('Skipping past event');
    }

    private scheduleUnsupportedLocationEntry(entry:CalendarEntry, instanceEntry:CalendarEntryMaster, log:Log) {
        const scheduledEvent = this.events.get(entry.Id);
        const loc = instanceEntry.Location != null ? instanceEntry.Location.DisplayName : null;

        if(scheduledEvent != null) {
            this.cancelScheduledEntry(entry.Id);
            log.info({loc},'Unscheduling event in unsupported locaton');
        }

        log.info({loc},'Skipping event in unsupported locaton');
    }

    private createEvent(entry:CalendarEntry, instanceEntry:CalendarEntryMaster, airconId:string, start:Date, end:Date, log:Log):ScheduledEvent {
        const startJob = schedule.scheduleJob(start, () => this.powerOnAircon(airconId, log));
        const endJob = schedule.scheduleJob(end, () => {
            this.powerOffAircon(airconId, log)
            this.cancelScheduledEntry(entry.Id);
        });

        const scheduledEvent = {
            id: entry.Id,
            entry,
            instanceEntry,
            start,
            end,
            startJob,
            endJob
        };

        this.events.set(entry.Id, scheduledEvent);

        return scheduledEvent;
    }

    private getAirconIdForEntry(entry:CalendarEntryMaster):string | null {
        for(const loc of entry.Locations) {
            const parts = loc.DisplayName.split('&').map(p => p.trim());
            for(const part of parts) {
                if(this.airconCtrls.has(part)) {
                    return this.airconCtrls.get(part);
                }
            }
        }

        for(const attendee of entry.Attendees) {
            if(this.airconCtrls.has(attendee.EmailAddress.Name)) {
                return this.airconCtrls.get(attendee.EmailAddress.Name);
            }
        }

        return null;
    }

    private cancelScheduledEntry(id:string) {
        const scheduledEvent = this.events.get(id);
        if(scheduledEvent == null) {
            return;
        }

        scheduledEvent.startJob.cancel();
        scheduledEvent.endJob.cancel();

        const now = new Date();
        if(now > scheduledEvent.start && now < scheduledEvent.end) {
            scheduledEvent.endJob.invoke();
        }

        this.events.delete(id);
    }

    private getEventLogInfo(entry:CalendarEntry, instance:CalendarEntryMaster) {
        const dateOptions = { hour: 'numeric', minute: 'numeric' };

        const start = new Date(entry.Start.DateTime);
        const end = new Date(entry.End.DateTime);
        const durationMin = Math.floor((end.getTime() - start.getTime()) / 60000);

        return {
            entry: entry.Id.substring(0, 10),
            instance: instance.Id.substring(0, 10),
            subject: instance.Subject.trim(),
            start: start.toLocaleDateString('en-GB', dateOptions),
            end: end.toLocaleDateString('en-GB', dateOptions),
            duration: `${durationMin}min`
        };
    }

    private getInstanceEntry(entry:CalendarEntry, entries:CalendarEntry[]):CalendarEntryMaster {
        let instanceEntry:CalendarEntryMaster;
        if(isEntryInstance(entry)) {
            instanceEntry = entry;
        } else if(isEntryOccurrence(entry)) {
            instanceEntry = entries.find(other => other.Id === entry.SeriesMasterId) as CalendarEntryMaster;
        }
        return instanceEntry;
    }

    private async powerOnAircon(airconId:string, log: Log) {
        log.info({power: 1, airconId}, 'Fire event');
        this.mqttClient.publish(`aircon/${airconId}/power`, '1', {retain: MQTT_RETAIN});
    }

    private async powerOffAircon(airconId:string, log: Log) {
        log.info({power: 0, airconId}, 'Fire event');
        this.mqttClient.publish(`aircon/${airconId}/power`, '0', {retain: MQTT_RETAIN});
    }
}
