FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    libaio1 \
    libnsl2 \
  && rm -rf /var/lib/apt/lists/*

ENV ORACLE_IC_VERSION=2113000
ENV ORACLE_IC_ZIP=instantclient-basiclite-linux.x64-21.13.0.0.0dbru.zip
ENV ORACLE_IC_URL=https://download.oracle.com/otn_software/linux/instantclient/${ORACLE_IC_VERSION}/${ORACLE_IC_ZIP}

RUN mkdir -p /opt/oracle \
  && curl -L -o /tmp/${ORACLE_IC_ZIP} ${ORACLE_IC_URL} \
  && unzip -q /tmp/${ORACLE_IC_ZIP} -d /opt/oracle \
  && rm /tmp/${ORACLE_IC_ZIP} \
  && ln -s $(ls -d /opt/oracle/instantclient_* | head -n 1) /opt/oracle/instantclient \
  && echo "/opt/oracle/instantclient" > /etc/ld.so.conf.d/oracle-instantclient.conf \
  && ldconfig

ENV ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient
ENV ORACLE_USE_THICK_MODE=true
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001

CMD ["npm", "start"]
