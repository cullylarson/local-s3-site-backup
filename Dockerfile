FROM mysql:5.7

RUN echo "America/Los_Angeles" | tee /etc/timezone && dpkg-reconfigure --frontend noninteractive tzdata

# Replace shell with bash so we can source files
RUN rm /bin/sh && ln -s /bin/bash /bin/sh

# Install base dependencies
RUN apt-get update && apt-get install -y -q --no-install-recommends \
        apt-transport-https \
        build-essential \
        ca-certificates \
        curl \
        git \
        libssl-dev \
        wget \
    && rm -rf /var/lib/apt/lists/*

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 10.15.0

# Install nvm with node and npm
RUN curl -s https://raw.githubusercontent.com/creationix/nvm/v0.20.0/install.sh | bash

RUN mkdir -p $NVM_DIR/versions/

RUN . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH $NVM_DIR/versions/v$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/versions/v$NODE_VERSION/bin:$PATH
