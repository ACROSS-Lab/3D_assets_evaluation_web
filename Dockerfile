# Release image 
FROM node:22-alpine3.19

WORKDIR /app

COPY . /app

RUN npm install

VOLUME ["/app/db"]

EXPOSE 3000
ENTRYPOINT ["node", "/app/app.js"]