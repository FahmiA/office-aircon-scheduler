import {Token, AccessToken, OAuthClient, create} from 'simple-oauth2';
import {Config} from './config';
import { Log } from 'bblog';
import * as fs from 'fs';

export class Auth {
    static readonly SCOPES = [
        'openid',
        'profile',
        'offline_access',
        'https://outlook.office.com/calendars.read.shared'
    ];

    static readonly LOCAL_URLS = {
        authorize: 'http://localhost:3000/authorize'
    };

    static readonly TOKEN_PATH = './.token';

    private client:OAuthClient;
    private token:AccessToken;
    private log:Log;

    constructor(log:Log) {
        this.log = log;

        const credentials = {
            client: {
                id: Config.app.clientId,
                secret: Config.app.clientSecret
            },
            auth: {
                tokenHost: 'https://login.microsoftonline.com',
                authorizePath: 'common/oauth2/v2.0/authorize',
                tokenPath: 'common/oauth2/v2.0/token'
            }
        };

        this.client = create(credentials);
    }

    async attemptStoredAuth() {
        const jsonToken = this.readToken();
        if(jsonToken == null) {
            return false;
        }

        this.log.info({path: Auth.TOKEN_PATH}, 'Found local authentication token');
        this.token = this.client.accessToken.create(jsonToken);
        await this.ensureAuthenticated();

        return true;
    }

    async authenticate(authCode:string) {
        const jsonToken = await this.client.authorizationCode.getToken({
            code: authCode,
            redirect_uri: Auth.LOCAL_URLS.authorize,
            scope: Auth.SCOPES.join(' ')
        });

        this.token = this.client.accessToken.create(jsonToken);
        this.storeToken(jsonToken);

        this.log.info('Authenticated with Outlook calander');
    }

    getLoginURL():string {
        return this.client.authorizationCode.authorizeURL({
            redirect_uri: Auth.LOCAL_URLS.authorize,
            scope: Auth.SCOPES.join(' ')
        });
    }

    async getEmail():Promise<string> {
        // JWT is in three parts, separated by a '.'
        const idToken = await this.getIdToken();
        const token_parts = idToken.split('.');

        // Token content is in the second part, in urlsafe base64
        const encoded_token = Buffer.from(token_parts[1].replace('-', '+').replace('_', '/'), 'base64');

        const decoded_token = encoded_token.toString();

        const jwt = JSON.parse(decoded_token);

        // Email is in the preferred_username field
        return jwt.preferred_username
    }

    async getIdToken():Promise<string> {
        await this.ensureAuthenticated();
        return this.token.token.id_token;
    }

    async getAccessToken():Promise<string> {
        await this.ensureAuthenticated();
        return this.token.token.access_token;
    }

    private async ensureAuthenticated():Promise<void> {
        if(!this.token.expired()) {
            return Promise.resolve();
        }

        this.token = await this.token.refresh();
        this.storeToken(this.token.token);
        this.log.info('Refreshed authentication token');
    }

    private storeToken(token:Token) {
        fs.writeFileSync(Auth.TOKEN_PATH, JSON.stringify(token, null, 2));
    }

    private readToken() {
        if(!fs.existsSync(Auth.TOKEN_PATH)) {
            return null;
        }

        return JSON.parse(fs.readFileSync(Auth.TOKEN_PATH).toString());
    }
};
