import * as outlook from 'node-outlook'
import {Auth} from './auth';
import {promisify} from 'util';
import * as fs from 'fs';
import {URL} from "url";
import {Config} from './config';

export interface CalanderEntryDateTime {
    DateTime: string; // ISO
    TimeZone: string; // New Zealand Standard Time
}

export interface CalanderAttendee {
    Type: 'Required' | 'Optional' | 'Resource';
    Status: {
        Response: 'None' | 'Organizer' | 'TentativelyAccepted' | 'Accepted' | 'Declined' | 'NotResponded';
        /** ISO.  The date and time that the response was returned. */
        Time:string;
    };
    EmailAddress: {
        Name: string;
        Address: string;
    }
};

export interface CalanderLocation {
    DisplayName: string;
    LocationUri: string;
    LocationType: string;
    UniqueId: string;
    UniqueIdType: string;
    Address: {
        Type: string;
        Street: string;
        City: string;
        State: string;
        CountryOrRegion: string;
        PostalCode: string;
    };
    Coordinates: {
        Latitude: number;
        Longitude: number;
    };
}

export enum CalendaryEntryType {
    MASTER = 'SeriesMaster',
    INSTANCE = 'SingleInstance',
    EXCEPTION = 'Exception',
    OCCURRENCE = 'Occurrence',
}

export interface CalendarEntry {
    Id: string;
    Type: CalendaryEntryType;
    Start: CalanderEntryDateTime;
    End: CalanderEntryDateTime;
}

export interface CalendarEntryOccurrence extends CalendarEntry {
    SeriesMasterId:string;
    Type: CalendaryEntryType.OCCURRENCE;
}

export interface CalendarEntryMaster extends CalendarEntry {
    ChangeKey: string;
    Subject: string;
    BodyPreview: string;
    Type: CalendaryEntryType.MASTER | CalendaryEntryType.INSTANCE | CalendaryEntryType.EXCEPTION;
    IsCancelled: boolean;
    WebLink: string;
    IsAllDay: boolean;
    Body: {
        ContentType: string; // HTML
        Content: string;
    };
    Location: CalanderLocation
    Locations: CalanderLocation[];
    Recurrence: any[]; // TODO
    Attendees: CalanderAttendee[];
}

export function isEntryOccurrence(entry:CalendarEntry): entry is CalendarEntryOccurrence {
    return entry.Type === 'Occurrence';
}

export function isEntryInstance(entry:CalendarEntry): entry is CalendarEntryMaster {
    return entry.Type === 'SingleInstance' || entry.Type === 'Exception';
}

export function isEntryMaster(entry:CalendarEntry): entry is CalendarEntryMaster {
    return entry.Type === 'SeriesMaster';
}

const syncEvents = promisify(outlook.calendar.syncEvents);

export class Calendar {
    auth:Auth;
    email:string;
    timezone:string;

    /** API token for retrieving new changes when syncing events. */
    deltaLink:string;

    constructor(auth:Auth, email:string, timezone:string) {
        this.auth = auth;
        this.email = email;
        this.timezone = timezone;
    }

    async fetch():Promise<CalendarEntry[]> {
        const now = new Date();
        const then = new Date(new Date().setDate(now.getDate()+1));

        const accessToken = await this.auth.getAccessToken();

        const makeApiCall = promisify(outlook.base.makeApiCall);
        const entries:CalendarEntry[] = [];

        let response;
        do {
            if(this.deltaLink != null) {
                response = await makeApiCall({
                    url: this.deltaLink,
                    token: accessToken
                });
            } else {
                response = await syncEvents({
                    token: accessToken,
                    user: {
                        email: this.email,
                        timezone: this.timezone
                    },
                    startDateTime: now.toISOString(),
                    endDateTime: then.toISOString()
                });
            }

            this.deltaLink = response['@odata.deltaLink'];

            if(response.value != null) {
                entries.push.apply(entries, response.value);
            }

        } while(response.value != null && response.value.length > 0);

        return entries.sort((e1, e2) => e1.Start.DateTime.localeCompare(e2.Start.DateTime));
    }
}
