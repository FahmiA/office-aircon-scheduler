FROM node:10-alpine

# Workaround until code parses calendar timezones
RUN apk add --no-cache tzdata

ENV HOME=/home/app
WORKDIR $HOME/

RUN yarn init --yes
ADD ./README.md .
ADD ./package.json .
ADD ./yarn.lock .
ADD ./tsconfig.json .
ADD ./src .

RUN yarn install && \
    yarn run build && \
    yarn install --production

CMD [ "node", "build/index.js" ]
