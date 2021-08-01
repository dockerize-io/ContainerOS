# ContainerOS

Lightweight ready-to-use container management system. Batteries [to be] included. Intended date of 1.0 release is December 2021.

## Goal of the project

To create a system, that able to replace Kubernetes in 95% of projects. Requirements:

- Easy to understand
- Lightweight and simple
- For developers, not for devops people
- Opinionated. All choses by majority of comunity.
- Zero configuration needed for production
- Easy to write JavaScript/TypeScript controllers
- Hardware-agnostic and cloud-independent. Ready to serve even on Raspberry Pi behind corporate firewall.
- Fail tolerant. Ready to operate on cheap hardware that breaks. Self-healing
- Scalable to 1000's of nodes
- Not expecting user to set load or scale of containers
- Geo-distributed with automated placement of containers close to consumers

## Get started 

Install docker:

```bash
curl -sSL https://get.docker.com/ | sh
```

Run ContainerOS:
```bash
docker run -d --name containeros --net=host -v "/var/run/docker.sock:/var/run/docker.sock" quay.io/containeros/containeros:v0.1.0 
```

Start your first container

```bash
curl --location --request POST 'http://127.0.0.1:8000/v1/microservice?password=dev' \
-H "Content-Type: application/json" \
--data-raw '{
    "name": "test-server",
    "scale": 2,
    "containers": {
        "reg": {"image": "quay.io/bitnami/nginx:latest", "httpPorts": {"80": "hello.localhost"}}
    }
}'
```

Check your containers started: 
```bash
docker ps
```

Check logs:
```bash
docker logs -f containeros
```

## Release notes

### v0.1.1
- Optimized pod-runner for frequent changes

### v0.1.0

- Starting consul in dev mode
- Creating and updating microservices
- Exposing microservice containers to random ports
- Auth with master password
- Container pre-pulling

## Modules

### core/microservice-controller

**Input**: 
- List of microservices
- List of pods
- Health of nodes

**Output**: 
- Creates pods and assigns them to nodes

### apps/cluster-api
**Input**: 
- User API requests

**Output**: 
- CRUD microservices

### core/pod-runner
**Input**: 
- List of pods (`/pods/${hostname}/`)

**Output**: 
- Starts and stops docker containers

### core/node-health-reporter
**Input**: 
- Node load information (CPU, RAM)

**Output**: 
- Node health values in the database

P.S. To be replaced by events, http requests or any other light-weight alternative

### core/set-up-node
To be renamed to `initial-configurator`

**Input**: 
- Hardcoded containers list

**Output**: 
- Starts consul