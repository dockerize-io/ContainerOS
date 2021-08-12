import { StoredPod, StoredPodStatus } from "containeros-sdk";
import logger from "../../lib/logger"
import { getContainerByName, isImagePulledSuccessfully, removeContainerHelper } from "../../lib/docker/dockerodeUtils"
import dockerode from "../../lib/docker/dockerode"
import createDockerodeConfig from "./funcs/createDockerodeConfig";
import { database } from "containeros-sdk"
import Dockerode from "dockerode";
import consulLib from "../../lib/consul/consulLib"


export default class Pod {
    storedPod: StoredPod
    private startPromise: Promise<void> = null
    private registeredServiceIds = []
    constructor(_storedPod: StoredPod) {
        this.storedPod = _storedPod
        this.startPromise = this.start()
    }
    public async awaitForStart() {
        await this.startPromise
    }
    private async start() {
        logger.info("Starting pod", this.storedPod.name)

        await database.podStatus.ready()
        const lastReportedStatus: StoredPodStatus = database.podStatus.get(this.storedPod.name)
        if (lastReportedStatus && lastReportedStatus.history[0]?.status === "Failed") {
            logger.info("Pod failed, not starting", this.storedPod.name)
            return
        }

        await database.podStatus.report(this.storedPod.name, {
            status: "Pending",
            reason: "PullingContainers",
            message: ""
        })

        //pull
        const pullResults = await Promise.all(
            this.storedPod.containers.map(cont => isImagePulledSuccessfully(cont.image))
        )
        for (let i = 0; i < pullResults.length; i++) {
            if (pullResults[i] === false) {
                await database.podStatus.report(this.storedPod.name, {
                    status: "Failed",
                    reason: "ContainerFailedPulling",
                    message: "Failed pulling image " + this.storedPod.containers[i].image
                })
                return;
            }
        }

        await database.podStatus.report(this.storedPod.name, {
            status: "Pending",
            reason: "StartingContainers",
            message: ""
        })

        //create containers

        let createdContainers: Dockerode.ContainerInfo[] = []
        try {
            createdContainers = await Promise.all(
                this.storedPod.containers.map(async cont => {
                    const conf = createDockerodeConfig(this.storedPod, cont)
                    let createdContainer = await getContainerByName(conf.name)
                    if (!createdContainer) {
                        logger.info('creating container', conf.name)
                        await dockerode.createContainer(conf)
                        createdContainer = await getContainerByName(conf.name)
                    }
                    return createdContainer
                })
            )
        } catch (e) {
            logger.info("Error creating containers", e)
            await database.podStatus.report(this.storedPod.name, {
                status: "Failed",
                reason: "ContainerFailedStarting",
                message: "Failed starting containers " + String(e).slice(0, 100)
            })
            return;
        }


        //start containers
        try {
            await Promise.all(
                createdContainers.map(async cont => {
                    if (cont.State !== 'running') {
                        logger.info('starting container', cont.Names[0].slice(1))
                        const containerToStart = dockerode.getContainer(cont.Id);

                        await containerToStart.start()
                    }
                })
            )
        } catch (e) {
            logger.warn("Error starting containers", e)
            await database.podStatus.report(this.storedPod.name, {
                status: "Failed",
                reason: "ContainerFailedStarting",
                message: "Failed starting containers " + String(e).slice(0, 500)
            })
            return;
        }

        createdContainers.map(async cont => {
            cont
            if (cont.State !== 'running') {
                const contByname = await getContainerByName(cont.Names[0].slice(1))
                const exposedPorts = contByname.Ports.filter(port => port.PublicPort)
                for (let { PublicPort, PrivatePort } of exposedPorts) {
                    const containerNameInPod = contByname.Labels['org.containeros.container.name']
                    const serviceName = this.storedPod.containers.find(c => c.name === containerNameInPod).services[PrivatePort]

                    this.registeredServiceIds.push(cont.Id)

                    await consulLib.registerService({
                        id: cont.Id,
                        name: serviceName,
                        port: PublicPort,
                        tags: []
                    })
                }
            }
        })

        await database.podStatus.report(this.storedPod.name, {
            status: "Running",
            reason: "Started",
            message: ""
        })
    }
    private stopStarted = false
    public async stop(force = false) {
        if (this.stopStarted) return
        this.stopStarted = true
        logger.info("Stopping pod", this.storedPod.name)

        await Promise.all(
            this.storedPod.containers.map(async cont => {
                const conf = createDockerodeConfig(this.storedPod, cont)
                await removeContainerHelper(conf.name, force ? 0 : 30)
            })
        )

        await Promise.all(
            this.registeredServiceIds.map(id => {
                return consulLib.deregisterService(id)
            })
        )

        await database.podStatus.report(this.storedPod.name, {
            status: "Removed",
            reason: "RemovedOk",
            message: ""
        })

    }
}