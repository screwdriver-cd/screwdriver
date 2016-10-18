# coding=utf-8
import socket
from string import Template
from subprocess import check_output, call, STDOUT, PIPE

dockerTemplate = '''
version: '2'
services:
    api:
        image: screwdrivercd/screwdriver:stable
        ports:
            - 9001:80
        volumes:
            - /var/run/docker.sock:/var/run/docker.sock:rw
        environment:
            PORT: 80
            URI: http://${ip}:9001
            ECOSYSTEM_UI: http://${ip}:9000
            ECOSYSTEM_STORE: http://${ip}:9002
            DATASTORE_PLUGIN: sequelize
            DATASTORE_SEQUELIZE_DIALECT: sqlite
            EXECUTOR_PLUGIN: docker
            SECRET_WHITELIST: "[]"
            EXECUTOR_DOCKER_DOCKER: |
                {
                    "socketPath": "/var/run/docker.sock"
                }
            SECRET_OAUTH_CLIENT_ID: ${oauth_id}
            SECRET_OAUTH_CLIENT_SECRET: ${oauth_secret}
            SECRET_JWT_PRIVATE_KEY: |
${private_key}
            SECRET_JWT_PUBLIC_KEY: |
${public_key}
    ui:
        image: screwdrivercd/ui:stable
        ports:
            - 9000:80
        environment:
            ECOSYSTEM_API: http://${ip}:9001

    store:
        image: screwdrivercd/store:stable
        ports:
            - 9002:80
        environment:
            URI: http://${ip}:9002
            SECRET_JWT_PUBLIC_KEY: |
${public_key}
'''

# Get the external IP by poking at Google's DNS
def get_ip_address():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    return s.getsockname()[0]

# Left-Pad a set of lines (split by \n) with spaces
def pad_lines(lines, length):
    return '\n'.join(map((lambda row: ''.rjust(length, ' ') + row), lines.split('\n')))

# Generate a new JWT
def generate_jwt():
    junk = check_output(['openssl', 'genrsa', '-out', 'jwt.pem', '1024'], stderr=STDOUT)
    junk = check_output(['openssl', 'rsa', '-in', 'jwt.pem', '-pubout', '-out', 'jwt.pub'], stderr=STDOUT)
    jwtPrivate = open('jwt.pem', 'r').read()
    jwtPublic = open('jwt.pub', 'r').read()
    junk = check_output(['rm', 'jwt.pem', 'jwt.pub'], stderr=STDOUT)

    return {
        'public_key': pad_lines(jwtPublic, 16),
        'private_key': pad_lines(jwtPrivate, 16)
    }

# Generate OAuth credentials from GitHub.com
def generate_oauth(ip):
    print Template('''
    Please create a new OAuth application on GitHub.com
    Go to https://github.com/settings/applications/new to start the process
    For 'Authorization callback URL' put http://${ip}:9001
    When done, please provide the following values:
    ''').substitute(ip=ip)

    id = raw_input('    Client ID: ');
    secret = raw_input('    Client Secret: ');

    print ''
    return {
        'oauth_id': id,
        'oauth_secret': secret
    }

def main():
    fields = {
        'ip': get_ip_address()
    }
    print '🎁   Boxing up Screwdriver'

    print '🔐   Generating signing secrets'
    fields = dict(fields, **generate_jwt())

    print '📦   Generating OAuth credentials'
    fields = dict(fields, **generate_oauth(fields['ip']))

    print '💾   Writing Docker Compose file'
    compose = Template(dockerTemplate).substitute(fields)
    open('docker-compose.yml', 'w').write(compose)

    print '🚀   Screwdriver is ready to launch!'
    print Template('''
    Just run the following commands to get started!
      $ docker-compose -p screwdriver up -d
      $ open http://${ip}:9000
    ''').safe_substitute(fields)
    prompt = raw_input('    Would you like to run them now? (y/n) ')
    if prompt.lower() == 'y':
        call('docker-compose -p screwdriver up -d', shell=True)
        call(Template('open http://${ip}:9000').safe_substitute(fields), shell=True)
        print '\n👍   Launched!'
    else:
        print '\n👍   Skipping launch (for now)'

    print '''
    A few more things to note:
      - To stop/reset Screwdriver
        $ docker-compose -p screwdriver down
      - If your internal IP changes, update the docker-compose.yml and your GitHub OAuth application
      - For help with this and more, find us on Slack at https://slack.screwdriver.cd

❤️   Screwdriver Crew
    '''

if __name__ == "__main__":
    main()
