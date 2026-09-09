FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN node docker/rewrite-env.mjs && npm run build

FROM nginx:alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
