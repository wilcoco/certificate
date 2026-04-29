FROM node:20-bookworm-slim

# Oracle Instant Client 설치 (thick mode 필요 시)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl unzip libaio1 libnsl2 && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /opt/oracle && \
    curl -fSL https://download.oracle.com/otn_software/linux/instantclient/2113000/instantclient-basiclite-linux.x64-21.13.0.0.0dbru.zip \
      -o /tmp/ic.zip && \
    unzip -q /tmp/ic.zip -d /opt/oracle && \
    mv /opt/oracle/instantclient_* /opt/oracle/instantclient && \
    rm /tmp/ic.zip && \
    echo '/opt/oracle/instantclient' > /etc/ld.so.conf.d/oracle.conf && ldconfig

ENV LD_LIBRARY_PATH=/opt/oracle/instantclient
ENV ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient
ENV ORACLE_USE_THICK_MODE=true

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "index.js"]
