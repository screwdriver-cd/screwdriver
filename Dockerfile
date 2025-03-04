FROM node:22

# Screwdriver Version
ARG VERSION=latest

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# update npm
RUN npm install -g npm
RUN npm cache clean -f

# Install Screwdriver API
RUN npm install --fetch-timeout=1200000 screwdriver-api@$VERSION
WORKDIR /usr/src/app/node_modules/screwdriver-api

# Setup configuration folder
RUN ln -s /usr/src/app/node_modules/screwdriver-api/config /config

# Expose the web service port
EXPOSE 8080

# Add dumb-init
RUN wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64
RUN chmod +x /usr/local/bin/dumb-init
ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]

# Run the service
CMD [ "node", "./bin/server" ]
