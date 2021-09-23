import * as core from '@actions/core';
import { Artifact } from "./Artifact";
import { Releases } from "./Releases";

export interface ArtifactUploader {
    uploadArtifacts(artifacts: Artifact[], releaseId: number, uploadUrl: string): Promise<void>
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class GithubArtifactUploader implements ArtifactUploader {
    constructor(
        private releases: Releases,
        private replacesExistingArtifacts: boolean = true,
        private removeArtifacts: boolean = false,
        private throwsUploadErrors: boolean = false,
    ) {
    }

    async uploadArtifacts(artifacts: Artifact[],
        releaseId: number,
        uploadUrl: string): Promise<void> {
        if (this.replacesExistingArtifacts) {
            await this.deleteUpdatedArtifacts(artifacts, releaseId)
        }
        if (this.removeArtifacts) {
            await this.deleteUploadedArtifacts(releaseId)
        }
        for (const artifact of artifacts) {
            await this.uploadArtifact(artifact, releaseId, uploadUrl)
        }
    }

    private async uploadArtifact(artifact: Artifact,
        releaseId: number,
        uploadUrl: string,
        retry = 4,
        retryDelay = 8) {
        try {
            core.debug(`Uploading artifact ${artifact.name}...`)
            await this.releases.uploadArtifact(uploadUrl,
                artifact.contentLength,
                artifact.contentType,
                artifact.readFile(),
                artifact.name,
                releaseId)
        } catch (error: any) {
            if (error.status >= 500 && retry > 0) {
                core.warning(`Failed to upload artifact ${artifact.name}. ${error.message}. Retrying after ${retryDelay} seconds...`)
                await sleep(retryDelay * 1000)
                await this.deleteUpdatedArtifacts([artifact], releaseId)
                await this.uploadArtifact(artifact, releaseId, uploadUrl, retry - 1, retryDelay * 2)
            } else {
                if (this.throwsUploadErrors) {
                    throw Error(`Failed to upload artifact ${artifact.name}. ${error.message}.`)
                } else {
                    core.warning(`Failed to upload artifact ${artifact.name}. ${error.message}.`)
                }
            }
        }
    }

    private async deleteUpdatedArtifacts(artifacts: Artifact[], releaseId: number): Promise<void> {
        const releaseAssets = await this.releases.listArtifactsForRelease(releaseId)
        const assetByName: Record<string, { id: number; name: string }> = {}
        releaseAssets.forEach(asset => {
            assetByName[asset.name] = asset
        });
        for (const artifact of artifacts) {
            const asset = assetByName[artifact.name]
            if (asset) {
                core.debug(`Deleting existing artifact ${artifact.name}...`)
                await this.releases.deleteArtifact(asset.id)
            }
        }
    }

    private async deleteUploadedArtifacts(releaseId: number): Promise<void> {
        const releaseAssets = await this.releases.listArtifactsForRelease(releaseId)
        for (const artifact of releaseAssets) {
            const asset = artifact
            core.debug(`Deleting existing artifact ${artifact.name}...`)
            await this.releases.deleteArtifact(asset.id)
        }
    }
}
