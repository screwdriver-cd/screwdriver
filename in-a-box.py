#!/usr/bin/env python
# coding=utf-8
"""
Set up a local instance of screwdriver on the local system
"""
from __future__ import print_function
import getpass
import json
import os
import socket
import sys
import distutils.spawn
from string import Template
from subprocess import check_output, call, STDOUT
try:
    from urllib.parse import urlparse
except ImportError:
    from urlparse import urlparse


DOCKER_TEMPLATE = '''
version: '2'
services:
    api:
        image: screwdrivercd/screwdriver:stable
        ports:
            - 9001:80
        volumes:
            - /var/run/docker.sock:/var/run/docker.sock:rw
            - ./data/:/tmp/sd-data/:rw
        environment:
            PORT: 80
            URI: http://${ip}:9001
            ECOSYSTEM_UI: http://${ip}:9000
            ECOSYSTEM_STORE: http://${ip}:9002
            DATASTORE_PLUGIN: sequelize
            DATASTORE_SEQUELIZE_DIALECT: sqlite
            DATASTORE_SEQUELIZE_STORAGE: /tmp/sd-data/storage.db
            EXECUTOR_PLUGIN: docker
            SECRET_WHITELIST: "[]"
            EXECUTOR_DOCKER_DOCKER: |
                {
                    "socketPath": "/var/run/docker.sock"
                }
            SCM_SETTING: |
                {
                    "${scm_plugin}": {
                        "plugin": "${scm_plugin}",
                        "config": ${scm_config}
                    }
                }
            SECRET_JWT_PRIVATE_KEY: |${private_key}
            SECRET_JWT_PUBLIC_KEY: |${public_key}
    ui:
        image: screwdrivercd/ui:stable
        ports:
            - 9000:80
        environment:
            ECOSYSTEM_API: http://${ip}:9001
            ECOSYSTEM_STORE: http://${ip}:9002

    store:
        image: screwdrivercd/store:stable
        ports:
            - 9002:80
        environment:
            ECOSYSTEM_UI: http://${ip}:9000
            URI: http://${ip}:9002
            SECRET_JWT_PUBLIC_KEY: |${public_key}
'''


def get_input(prompt=None):
    """
    Read a string from standard input.  The trailing newline is stripped.

    The prompt string, if given, is printed to standard output without a
    trailing newline before reading input.

    Parameters
    ----------
    prompt: str, optional
        The prompt string to present

    Returns
    -------
    str
        User input

    Raises
    ------
    EOFError - If the user hits EOF (*nix: Ctrl-D, Windows: Ctrl-Z+Return)
    """
    if sys.version_info.major < 3:
        return raw_input(prompt)
    return input(prompt)


def get_ip_address():
    """
    Check IP locally if running in a docker-machine from docker-toolbox
    otherwise, get IP by poking at Google's DNS.

    Note
    ----
    docker-for-mac does not set DOCKER environment variables
    """
    if os.environ.get('DOCKER_HOST'):
        url = urlparse(os.environ['DOCKER_HOST'])
        return url.hostname
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.connect(("8.8.8.8", 80))
    return sock.getsockname()[0]


def pad_lines(lines, length):
    """
    Left pad set of lines with spaces
    """
    lines = lines.split(os.linesep)
    prefix = os.linesep + ' ' * int(length)
    return prefix + prefix.join(lines)


def generate_jwt():
    """
    Generate a new JWT

    Returns
    -------
    dict
        Dictionary with public_key and private_key
    """
    check_output(
        ['openssl', 'genrsa', '-out', 'jwt.pem', '1024'], stderr=STDOUT
    )
    check_output(
        ['openssl', 'rsa', '-in', 'jwt.pem', '-pubout', '-out', 'jwt.pub'],
        stderr=STDOUT
    )
    jwt_private = open('jwt.pem', 'r').read().strip()
    jwt_public = open('jwt.pub', 'r').read().strip()
    check_output(['rm', 'jwt.pem', 'jwt.pub'], stderr=STDOUT)

    return {
        'public_key': pad_lines(jwt_public, 16),
        'private_key': pad_lines(jwt_private, 16)
    }

# Ask to select a SCM provider
def select_scm_provider():
    scm_plugins = ['github', 'gitlab', 'bitbucket']
    while True:
        prompt = get_input('📤   Which SCM provider would you like to use? (github/gitlab/bitbucket) ')
        scm_plugin = prompt.lower()
        if scm_plugin in scm_plugins:
            break

    return {
        'scm_plugin': scm_plugin
    }

def generate_scm_config(scm_plugin, ip):
    """
    Generate OAuth credentials from SCM

    Parameters
    ----------
    scm_plugin: str
        The SCM provider
    ip: str
        The IP address
    """
    scm_config = {
        'username': 'sd-buildbot',
        'email': 'dev-null@screwdriver.cd'
    }
    if scm_plugin == 'github':
        service_name = 'GitHub.com'
        start_url = 'https://github.com/settings/applications/new'
        homepage_url_msg = "For 'Homepage URL' put http://" + ip + ':9000'
        callback_url = 'Authorization callback URL'
        additional_process = ''
        client_id_name = 'Client ID'
        client_secret_name = 'Client Secret'
        scm_config['secret'] = 'SUPER-SECRET-SIGNING-THING'
    elif scm_plugin == 'bitbucket':
        service_name = 'Bitbucket.org'
        start_url = 'https://bitbucket.org/account/user/<your username>/oauth-consumers/new'
        homepage_url_msg =  "For 'URL' put http://" + ip + ':9000'
        callback_url = 'Callback URL'
        additional_process = "for 'Permissions' enable Read checkbox for Repositories, Account and Pull requests"
        client_id_name = 'Key'
        client_secret_name = 'Secret'
    elif scm_plugin == 'gitlab':
        service_name = 'Gitlab.com'
        start_url = 'https://gitlab.com/profile/applications'
        homepage_url_msg = ''
        callback_url = 'Redirect URL'
        additional_process = ''
        client_id_name = 'Application Id'
        client_secret_name = 'Secret'

    print('''
    Please create a new OAuth application on {service_name}
    Go to {start_url} to start the process
    {homepage_url_msg}
    For '{callback_url}' put http://{ip}:9001/v4/auth/login
    {additional_process}
    When done, please provide the following values:
    '''.format(
        ip = ip,
        start_url = start_url,
        service_name = service_name,
        homepage_url_msg = homepage_url_msg,
        callback_url = callback_url,
        additional_process = additional_process
    ))

    client_id = get_input('    %s: ' % client_id_name)
    secret = getpass.getpass('    %s: ' % client_secret_name)

    scm_config['oauthClientId'] = client_id
    scm_config['oauthClientSecret'] = secret

    print('')
    return dict(scm_config=json.dumps(scm_config))


def check_component(component):
    """
    Search for a component executable and exit if not found
    """
    if distutils.spawn.find_executable(component) is None:
        print(
            '💀   Could not find {0}, please install and set path to '
            '{0}'.format(component)
        )
        sys.exit(1)


def main():
    """
    Main code function
    """
    fields = {
        'ip': get_ip_address()
    }
    print('🎁   Boxing up Screwdriver')

    print('👀   Checking prerequisites')
    check_component('docker')
    check_component('docker-compose')
    check_component('openssl')

    print('🔐   Generating signing secrets')
    fields.update(generate_jwt())

    fields = dict(fields, **select_scm_provider())

    print('📦   Generating OAuth credentials')
    fields.update(generate_scm_config(fields['scm_plugin'], fields['ip']))

    print('💾   Writing Docker Compose file')
    compose = Template(DOCKER_TEMPLATE).substitute(fields)
    open('docker-compose.yml', 'w').write(compose)

    print('🚀   Screwdriver is ready to launch!')
    print(
        Template('''
    Just run the following commands to get started!
      $ docker-compose pull
      $ docker-compose -p screwdriver up -d
      $ open http://${ip}:9000
    ''').safe_substitute(fields)
    )
    prompt = get_input('    Would you like to run them now? (y/n) ')
    if prompt.lower() == 'y':
        call(['docker-compose', 'pull'])
        call(['docker-compose', '-p', 'screwdriver', 'up', '-d'])
        call(['open', Template('http://${ip}:9000').safe_substitute(fields)])
        print('\n👍   Launched!')
    else:
        print('\n👍   Skipping launch (for now)')

    print('''
    A few more things to note:
      - To stop/reset Screwdriver
        $ docker-compose -p screwdriver down
      - If your internal IP changes, update the docker-compose.yml and your SCM OAuth application
      - In-a-box does not support Webhooks including PullRequests for triggering builds
      - For help with this and more, find us on Slack at https://slack.screwdriver.cd

❤️   Screwdriver Crew
    ''')


if __name__ == "__main__":
    sys.stdin.flush()
    main()
