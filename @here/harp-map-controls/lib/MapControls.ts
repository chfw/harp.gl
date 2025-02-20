/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as geoUtils from "@here/harp-geoutils";
import { MapView, MapViewEventNames, MapViewUtils } from "@here/harp-mapview";
import * as THREE from "three";
import * as utils from "./Utils";

enum State {
    NONE,
    PAN,
    ROTATE,
    ORBIT,
    TOUCH
}

export enum TiltState {
    Tilted,
    Down
}

interface TouchState {
    currentTouchPoint: THREE.Vector2;
    lastTouchPoint: THREE.Vector2;
    currentWorldPosition: THREE.Vector3;
    initialWorldPosition: THREE.Vector3;
}

/**
 * Map interaction events' names.
 */
export enum EventNames {
    Update = "update",
    BeginInteraction = "begin-interaction",
    EndInteraction = "end-interaction"
}

// cast needed to workaround wrong three.js typings.
const MAPCONTROL_EVENT: THREE.Event = { type: EventNames.Update } as any;
const MAPCONTROL_EVENT_BEGIN_INTERACTION: THREE.Event = {
    type: EventNames.BeginInteraction
} as any;
const MAPCONTROL_EVENT_END_INTERACTION: THREE.Event = {
    type: EventNames.EndInteraction
} as any;

/**
 * Yaw rotation as quaternion. Declared as a const to avoid object re-creation across frames.
 */
const yawQuaternion = new THREE.Quaternion();
/**
 * Pitch rotation as quaternion. Declared as a const to avoid object re-creation across frames.
 */
const pitchQuaternion = new THREE.Quaternion();

/**
 * Quaternion used for globe calculations. Declared as a const to avoid re-creation across frames.
 */
const quaternion = new THREE.Quaternion();

/**
 * Matrix declared as a const to avoid re-creation across frames.
 */
const matrix = new THREE.Matrix4();

/**
 * The yaw axis around which we rotate when we change the yaw.
 * This axis is fixed and is the -Z axis `(0,0,1)`.
 */
const yawAxis = new THREE.Vector3(0, 0, 1);
/**
 * The pitch axis which we use to rotate around when we change the pitch.
 * The axis is fix and is the +X axis `(1,0,0)`.
 */
const pitchAxis = new THREE.Vector3(1, 0, 0);

/**
 * The number of the steps for which, when pitching the camera, the delta altitude is scaled until
 * it reaches the minimum camera height.
 */
const MAX_DELTA_ALTITUDE_STEPS = 10;

/**
 * The number of user's inputs to consider for panning inertia, to reduce erratic inputs.
 */
const USER_INPUTS_TO_CONSIDER = 5;

/**
 * The default maximum for the camera pitch. This value avoids seeing the horizon.
 */
const DEFAULT_MAX_PITCH_ANGLE = Math.PI / 4;

/**
 * Epsilon value to rule out when a number can be considered 0.
 */
const EPSILON = 0.01;

/**
 * This map control provides basic map-related building blocks to interact with the map. It also
 * provides a default way of handling user input. Currently we support basic mouse interaction and
 * touch input interaction.
 *
 * Mouse interaction:
 *  - Left mouse button + move = Panning the map.
 *  - Right mouse button + move = Orbits the camera around the focus point.
 *  - Middle mouse button + move = Rotating the view. Up down movement changes the pitch. Left/right
 *    movement changes the yaw.
 *  - Mouse wheel = Zooms up and down by one zoom level, zooms on target.
 *
 * Touch interaction:
 *  - One finger = Panning the map.
 *  - Two fingers = Scale, rotate and panning the map.
 *  - Three fingers = Orbiting the map. Up down movements influences the current orbit altitude.
 *    Left/right changes the azimuth.
 */
export class MapControls extends THREE.EventDispatcher {
    /**
     * Creates MapControls object and attaches it specified [[MapView]].
     *
     * @param mapView - [[MapView]] object to which MapControls should be attached to.
     */
    static create(mapView: MapView) {
        return new MapControls(mapView);
    }

    /**
     * This factor will be applied to the delta of the current mouse pointer position and the last
     * mouse pointer position: The result then will be used as an offset for the rotation then.
     * Default value is `0.1`.
     */
    rotationMouseDeltaFactor = 0.1;

    /**
     * This factor will be applied to the delta of the current mouse pointer position and the last
     * mouse pointer position: The result then will be used as an offset to orbit the camera.
     * Default value is `0.1`.
     */
    orbitingMouseDeltaFactor = 0.1;

    /**
     * This factor will be applied to the delta of the current touch pointer position and the last
     * touch pointer position: The result then will be used as an offset to orbit the camera.
     * Default value is `0.1`.
     */
    orbitingTouchDeltaFactor = 0.1;

    /**
     * Set to `true` to enable input handling through this map control, `false` to disable input
     * handling. Even when disabling input handling, you can manually use the public functions to
     * change the view to the current map.
     */
    enabled = true;

    /**
     * Set to `true` to enable orbiting and Pitch axis rotation through this map control, `false` to
     * disable orbiting and Pitch axis rotation.
     */
    tiltEnabled = true;

    /**
     * Set to `true` to enable rotation through this map control, `false` to disable rotation.
     */
    rotateEnabled = true;

    /**
     * Set to `true` to enable an inertia dampening on zooming and panning. `false` cancels inertia.
     */
    inertiaEnabled = true;

    /**
     * Inertia damping duration for the zoom, in seconds.
     */
    zoomInertiaDampingDuration = 0.5;

    /**
     * Inertia damping duration for the panning, in seconds.
     */
    panInertiaDampingDuration = 1.0;

    /**
     * Duration in seconds of the camera animation when the tilt button is clicked. Independent of
     * inertia.
     */
    tiltToggleDuration = 0.5;

    /**
     * Camera pitch target when tilting it from the UI button.
     */
    tiltAngle = Math.PI / 4;

    /**
     * Determines the zoom level delta for single mouse wheel movement. So after each mouse wheel
     * movement the current zoom level will be added or subtracted by this value. The default value
     * is `0.2` - this means that every 5th mouse wheel movement you will cross a zoom level.
     *
     * **Note**: To reverse the zoom direction, you can provide a negative value.
     */
    zoomLevelDeltaOnMouseWheel = 0.2;

    /**
     * Zoom level delta when using the UI controls.
     */
    zoomLevelDeltaOnControl = 1.0;

    /**
     * Determines the minimum zoom level we can zoom to.
     */
    minZoomLevel = 0;

    /**
     * Determines the maximum zoom level we can zoom to.
     */
    maxZoomLevel = 20;

    /**
     * Determines the minimum camera height in meter.
     */
    minCameraHeight = 3;

    /**
     * Three.js camera that this controller affects.
     */
    readonly camera: THREE.Camera;

    /**
     * Map's HTML DOM element.
     */
    readonly domElement: HTMLCanvasElement;

    private readonly m_currentViewDirection = new THREE.Vector3();

    private readonly m_lastMousePosition = new THREE.Vector2(0, 0);
    private readonly m_mouseDelta = new THREE.Vector2(0, 0);

    private m_needsRenderLastFrame: boolean = true;

    private m_panIsAnimated: boolean = false;
    private m_panDistanceFrameDelta: THREE.Vector3 = new THREE.Vector3();
    private m_panAnimationTime: number = 0;
    private m_panAnimationStartTime: number = 0;
    private m_lastAveragedPanDistance: number = 0;
    private m_currentInertialPanningSpeed: number = 0;
    private m_lastPanVector: THREE.Vector3 = new THREE.Vector3();
    private m_recentPanDistances: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    private m_currentPanDistanceIndex: number = 0;

    private m_zoomIsAnimated: boolean = false;
    private m_zoomDeltaRequested: number = 0;
    private m_zoomTargetNormalizedCoordinates: THREE.Vector2 = new THREE.Vector2();
    private m_zoomAnimationTime: number = 0;
    private m_zoomAnimationStartTime: number = 0;
    private m_startZoom: number = 0;
    private m_targetedZoom?: number;
    private m_currentZoom?: number;

    private m_tiltIsAnimated: boolean = false;
    private m_pitchRequested?: number = undefined;
    private m_tiltAnimationTime: number = 0;
    private m_tiltAnimationStartTime: number = 0;
    private m_startPitch: number = 0;
    private m_targetedPitch?: number;
    private m_currentPitch?: number;

    private m_tiltState?: TiltState;
    private m_state: State = State.NONE;

    private m_tmpVector2: THREE.Vector2 = new THREE.Vector2();
    private m_tmpVector3: THREE.Vector3 = new THREE.Vector3();

    /**
     * Determines the minimum angle the camera can pitch to. It is defined in radians.
     */
    private m_minPitchAngle = 0;

    /**
     * Determines the maximum angle the camera can pitch to. It is defined in radians.
     */
    private m_maxPitchAngle = DEFAULT_MAX_PITCH_ANGLE;

    private m_cleanupMouseEventListeners?: () => void;

    private m_touchState: {
        touches: TouchState[];
        currentRotation: number;
        initialRotation: number;
    } = {
        touches: [],
        currentRotation: 0,
        initialRotation: 0
    };

    /**
     * Constructs a new `MapControls` object.
     *
     * @param mapView [[MapView]] this controller modifies.Z
     */
    constructor(readonly mapView: MapView) {
        super();

        this.camera = mapView.camera;
        this.domElement = mapView.renderer.domElement;
        this.maxZoomLevel = mapView.maxZoomLevel;
        this.minZoomLevel = mapView.minZoomLevel;
        this.minCameraHeight = mapView.minCameraHeight;
        this.bindInputEvents(this.domElement);
        this.handleZoom = this.handleZoom.bind(this);
        this.pan = this.pan.bind(this);
        this.tilt = this.tilt.bind(this);
    }

    /**
     * Destroy this `MapControls` instance.
     *
     * Unregisters all grobal event handlers used. This is method should be called when you stop
     * using `MapControls`.
     */
    dispose = () => {
        // replaced with real code in bindInputEvents
    };

    /**
     * Rotates the camera by the given delta yaw and delta pitch.
     *
     * @param deltaYaw Delta yaw in degrees.
     * @param deltaPitch Delta pitch in degrees.
     */
    rotate(deltaYaw: number, deltaPitch: number) {
        if (this.inertiaEnabled && this.m_zoomIsAnimated) {
            this.stopZoom();
        }

        const yawPitchRoll = MapViewUtils.extractYawPitchRoll(this.camera.quaternion);

        //yaw
        let yawAngle = yawPitchRoll.yaw;
        if (this.rotateEnabled) {
            yawAngle -= geoUtils.MathUtils.degToRad(deltaYaw);
        }
        yawQuaternion.setFromAxisAngle(yawAxis, yawAngle);

        //pitch
        const deltaPitchRadians = geoUtils.MathUtils.degToRad(deltaPitch);
        const pitchAngle = this.constrainPitchAngle(yawPitchRoll.pitch, deltaPitchRadians);
        pitchQuaternion.setFromAxisAngle(pitchAxis, pitchAngle);

        yawQuaternion.multiply(pitchQuaternion);
        this.mapView.camera.quaternion.copy(yawQuaternion);
        this.mapView.camera.matrixWorldNeedsUpdate = true;
    }

    /**
     * Current viewing angles yaw/pitch/roll in degrees.
     */
    get yawPitchRoll(): MapViewUtils.YawPitchRoll {
        const ypr = MapViewUtils.extractYawPitchRoll(this.camera.quaternion);
        return {
            yaw: geoUtils.MathUtils.radToDeg(ypr.yaw),
            pitch: geoUtils.MathUtils.radToDeg(ypr.pitch),
            roll: geoUtils.MathUtils.radToDeg(ypr.roll)
        };
    }

    /*
     * Orbits the camera around the focus point of the camera. The `deltaAzimuth` and
     * `deltaAltitude` are offsets in degrees to the current azimuth and altitude of the current
     * orbit.
     *
     * @param deltaAzimuth Delta azimuth in degrees.
     * @param deltaAltitude Delta altitude in degrees.
     */
    orbitFocusPoint(deltaAzimuth: number, deltaAltitude: number) {
        if (this.mapView.projection.type === geoUtils.ProjectionType.Spherical) {
            return;
        }
        if (this.inertiaEnabled && this.m_zoomIsAnimated) {
            this.stopZoom();
        }

        this.mapView.camera.getWorldDirection(this.m_currentViewDirection);
        const currentAzimuthAltitude = utils.directionToAzimuthAltitude(
            this.m_currentViewDirection
        );

        const topElevation =
            (1.0 / Math.sin(currentAzimuthAltitude.altitude)) * this.mapView.camera.position.z;
        const focusPointInWorldPosition = MapViewUtils.rayCastWorldCoordinates(this.mapView, 0, 0);

        const deltaAltitudeConstrained = this.getMinDelta(deltaAltitude);

        this.rotate(deltaAzimuth, deltaAltitudeConstrained);

        this.mapView.camera.getWorldDirection(this.m_currentViewDirection);
        const newAzimuthAltitude = utils.directionToAzimuthAltitude(this.m_currentViewDirection);

        const newElevation = Math.sin(newAzimuthAltitude.altitude) * topElevation;
        this.mapView.camera.position.z = newElevation;
        const newFocusPointInWorldPosition = MapViewUtils.rayCastWorldCoordinates(
            this.mapView,
            0,
            0
        );

        if (!focusPointInWorldPosition || !newFocusPointInWorldPosition) {
            // We do this to trigger an update in all cases.
            this.updateMapView();
            return;
        }

        const diff = focusPointInWorldPosition.sub(newFocusPointInWorldPosition);
        MapViewUtils.pan(this.mapView, diff.x, diff.y);
    }

    /**
     * Moves the camera along the view direction in meters.
     * A positive value will move the camera further away from the point where the camera looks at.
     * A negative value will move the camera near to the point where the camera looks at.
     *
     * @param amount Amount to move along the view direction in meters.
     */
    moveAlongTheViewDirection(amount: number) {
        this.mapView.camera.getWorldDirection(this.m_currentViewDirection);
        this.m_currentViewDirection.multiplyScalar(amount);
        this.mapView.camera.position.z += this.m_currentViewDirection.z;
        this.updateMapView();
    }

    /**
     * Sets the rotation of the camera according to yaw and pitch in degrees.
     *
     * **Note:** `yaw == 0 && pitch == 0` will north up the map and you will look downwards onto the
     * map.
     *
     * @param yaw Yaw in degrees.
     * @param pitch Pitch in degrees.
     */
    setRotation(yaw: number, pitch: number): void {
        MapViewUtils.setRotation(this.mapView, yaw, pitch);
    }

    /**
     * Zooms and moves the map in such a way that the given target position remains at the same
     * position after the zoom.
     *
     * @param targetPositionOnScreenXinNDC Target x position in NDC space.
     * @param targetPositionOnScreenYinNDC Target y position in NDC space.
     */
    zoomOnTargetPosition(
        targetPositionOnScreenXinNDC: number,
        targetPositionOnScreenYinNDC: number,
        zoomLevel: number
    ) {
        MapViewUtils.zoomOnTargetPosition(
            this.mapView,
            targetPositionOnScreenXinNDC,
            targetPositionOnScreenYinNDC,
            zoomLevel
        );
    }

    /**
     * Zooms to the desired location by the provided value.
     *
     * @param zoomLevel Zoom level.
     * @param screenTarget Zoom target on screen.
     */
    setZoomLevel(
        zoomLevel: number,
        screenTarget: { x: number; y: number } | THREE.Vector2 = { x: 0, y: 0 }
    ) {
        if (this.enabled === false) {
            return;
        }

        this.dispatchEvent(MAPCONTROL_EVENT_BEGIN_INTERACTION);
        // Register the zoom request
        this.m_startZoom = this.currentZoom;
        this.m_zoomDeltaRequested = zoomLevel - this.zoomLevelTargeted;
        // Cancel panning so the point of origin of the zoom is maintained.
        this.m_panDistanceFrameDelta.set(0, 0, 0);
        this.m_lastAveragedPanDistance = 0;

        // Assign the new animation start time.
        this.m_zoomAnimationStartTime = performance.now();

        if (this.mapView.projection.type === geoUtils.ProjectionType.Planar) {
            this.m_zoomTargetNormalizedCoordinates.set(screenTarget.x, screenTarget.y);
            this.handleZoom();
        } else {
            const surfaceNormal = this.mapView.projection.surfaceNormal(
                this.camera.position,
                new THREE.Vector3()
            );

            // TODO: HARP-5431 Use the elevation provider to find the ground distance
            // if terrain is enabled.
            this.camera.position.addScaledVector(
                surfaceNormal,
                ((this.zoomLevelTargeted - zoomLevel) / this.zoomLevelDeltaOnMouseWheel) *
                    this.mapView.projection.groundDistance(this.camera.position) *
                    0.05
            );

            // TODO: HARP-5430 Ensures that we don't intersect the terrain, a similar
            // approach to that should be used here, at least for consistency sake.
            if (this.mapView.projection.groundDistance(this.camera.position) < 500) {
                this.mapView.projection.scalePointToSurface(this.camera.position);
                this.camera.position.addScaledVector(surfaceNormal, 500);
            }

            this.updateMapView();
        }

        this.dispatchEvent(MAPCONTROL_EVENT_END_INTERACTION);
    }

    /**
     * Toggles the camera pitch between 0 (looking down) and the value at `this.tiltAngle`.
     */
    toggleTilt(): void {
        this.m_startPitch = this.currentPitch;
        const aimTilt = this.m_startPitch < EPSILON || this.m_tiltState === TiltState.Down;
        this.m_pitchRequested = aimTilt ? this.tiltAngle : 0;
        this.m_tiltState = aimTilt ? TiltState.Tilted : TiltState.Down;
        this.m_tiltAnimationStartTime = performance.now();
        this.tilt();
    }

    /**
     * Set the camera height.
     */
    set cameraHeight(height: number) {
        //Set the cameras height according to the given zoom level.
        this.camera.position.setZ(height);
        this.camera.matrixWorldNeedsUpdate = true;
    }

    /**
     * Get the current camera height.
     */
    get cameraHeight(): number {
        // ### Sync with the way geoviz is computing the zoom level.
        return this.mapView.camera.position.z;
    }

    /**
     * Set camera max pitch angle.
     *
     * @param angle Angle in degrees.
     */
    set maxPitchAngle(angle: number) {
        this.m_maxPitchAngle = geoUtils.MathUtils.degToRad(angle);
    }

    /**
     * Get the camera max pitch angle in degrees.
     */
    get maxPitchAngle(): number {
        return geoUtils.MathUtils.radToDeg(this.m_maxPitchAngle);
    }

    /**
     * Set camera min pitch angle.
     *
     * @param angle Angle in degrees.
     */
    set minPitchAngle(angle: number) {
        this.m_minPitchAngle = geoUtils.MathUtils.degToRad(angle);
    }

    /**
     * Get the camera min pitch angle in degrees.
     */
    get minPitchAngle(): number {
        return geoUtils.MathUtils.radToDeg(this.m_minPitchAngle);
    }

    /**
     * Get the zoom level targeted by `MapControls`. Useful when inertia is on, to add incremented
     * values to the target instead of getting the random zoomLevel value during the interpolation.
     */
    get zoomLevelTargeted(): number {
        return this.m_targetedZoom === undefined ? this.currentZoom : this.m_targetedZoom;
    }

    /**
     * Handy getter to know if the view is in the process of looking down or not.
     */
    get tiltState(): TiltState {
        if (this.m_tiltState === undefined) {
            this.m_tiltState =
                this.currentPitch < EPSILON || this.m_tiltState === TiltState.Down
                    ? TiltState.Tilted
                    : TiltState.Down;
        }
        return this.m_tiltState;
    }

    private set currentZoom(zoom: number) {
        this.m_currentZoom = zoom;
    }

    private get currentZoom(): number {
        return this.m_currentZoom !== undefined ? this.m_currentZoom : this.mapView.zoomLevel;
    }

    private set currentPitch(pitch: number) {
        this.m_currentPitch = pitch;
    }

    private get currentPitch(): number {
        return MapViewUtils.extractYawPitchRoll(this.mapView.camera.quaternion).pitch;
    }

    private get targetedPitch(): number {
        return this.m_targetedPitch === undefined
            ? this.m_currentPitch === undefined
                ? this.currentPitch
                : this.m_currentPitch
            : this.m_targetedPitch;
    }

    private tilt() {
        if (this.m_pitchRequested !== undefined) {
            this.m_targetedPitch = Math.max(
                Math.min(this.m_pitchRequested, this.maxPitchAngle),
                this.m_minPitchAngle
            );
            this.m_pitchRequested = undefined;
        }

        if (this.inertiaEnabled) {
            if (!this.m_tiltIsAnimated) {
                this.m_tiltIsAnimated = true;
                this.mapView.addEventListener(MapViewEventNames.AfterRender, this.tilt);
            }
            const currentTime = performance.now();
            this.m_tiltAnimationTime = (currentTime - this.m_tiltAnimationStartTime) / 1000;
            const tiltFinished = this.m_tiltAnimationTime > this.tiltToggleDuration;
            if (tiltFinished) {
                if (this.m_needsRenderLastFrame) {
                    this.m_needsRenderLastFrame = false;
                    this.m_tiltAnimationTime = this.tiltToggleDuration;
                    this.stopTilt();
                }
            } else {
                this.m_needsRenderLastFrame = true;
            }
        }

        this.m_currentPitch = this.inertiaEnabled
            ? this.easeOutCubic(
                  this.m_startPitch,
                  this.targetedPitch,
                  Math.min(1, this.m_tiltAnimationTime / this.tiltToggleDuration)
              )
            : this.targetedPitch;

        const initialPitch = this.currentPitch;
        const deltaAngle = this.m_currentPitch - initialPitch;
        const oldCameraDistance = this.mapView.camera.position.z / Math.cos(initialPitch);
        const newHeight = Math.cos(this.currentPitch) * oldCameraDistance;

        this.orbitFocusPoint(
            newHeight - this.camera.position.z,
            geoUtils.MathUtils.radToDeg(deltaAngle)
        );

        this.updateMapView();
    }

    private stopTilt() {
        this.mapView.removeEventListener(MapViewEventNames.AfterRender, this.tilt);
        this.m_tiltIsAnimated = false;
        this.m_targetedPitch = this.m_currentPitch = undefined;
    }

    private easeOutCubic(startValue: number, endValue: number, time: number): number {
        return startValue + (endValue - startValue) * (--time * time * time + 1);
    }

    private handleZoom() {
        if (this.m_zoomDeltaRequested !== 0) {
            this.m_targetedZoom = Math.max(
                Math.min(this.zoomLevelTargeted + this.m_zoomDeltaRequested, this.maxZoomLevel),
                this.minZoomLevel
            );
            this.m_zoomDeltaRequested = 0;
        }
        if (this.inertiaEnabled) {
            if (!this.m_zoomIsAnimated) {
                this.m_zoomIsAnimated = true;
                this.mapView.addEventListener(MapViewEventNames.AfterRender, this.handleZoom);
            }
            const currentTime = performance.now();
            this.m_zoomAnimationTime = (currentTime - this.m_zoomAnimationStartTime) / 1000;
            const zoomFinished = this.m_zoomAnimationTime > this.zoomInertiaDampingDuration;
            if (zoomFinished) {
                if (this.m_needsRenderLastFrame) {
                    this.m_needsRenderLastFrame = false;
                    this.m_zoomAnimationTime = this.zoomInertiaDampingDuration;
                    this.stopZoom();
                }
            } else {
                this.m_needsRenderLastFrame = true;
            }
        }

        this.currentZoom =
            !this.inertiaEnabled || Math.abs(this.zoomLevelTargeted - this.m_startZoom) < EPSILON
                ? this.zoomLevelTargeted
                : this.easeOutCubic(
                      this.m_startZoom,
                      this.zoomLevelTargeted,
                      Math.min(1, this.m_zoomAnimationTime / this.zoomInertiaDampingDuration)
                  );

        MapViewUtils.zoomOnTargetPosition(
            this.mapView,
            this.m_zoomTargetNormalizedCoordinates.x,
            this.m_zoomTargetNormalizedCoordinates.y,
            this.currentZoom
        );

        this.updateMapView();
    }

    private stopZoom() {
        this.mapView.removeEventListener(MapViewEventNames.AfterRender, this.handleZoom);
        this.m_zoomIsAnimated = false;
    }

    private pan() {
        if (this.m_state === State.NONE && this.m_lastAveragedPanDistance === 0) {
            return;
        }

        if (this.inertiaEnabled && !this.m_panIsAnimated) {
            this.m_panIsAnimated = true;
            this.mapView.addEventListener(MapViewEventNames.AfterRender, this.pan);
        }

        const applyInertia =
            this.inertiaEnabled &&
            this.m_state === State.NONE &&
            this.m_lastAveragedPanDistance > 0;

        if (applyInertia) {
            const currentTime = performance.now();
            this.m_panAnimationTime = (currentTime - this.m_panAnimationStartTime) / 1000;
            const panFinished = this.m_panAnimationTime > this.panInertiaDampingDuration;

            if (panFinished) {
                if (this.m_needsRenderLastFrame) {
                    this.m_needsRenderLastFrame = false;
                    this.m_panAnimationTime = this.panInertiaDampingDuration;
                    this.mapView.removeEventListener(MapViewEventNames.AfterRender, this.pan);
                    this.m_panIsAnimated = false;
                }
            } else {
                this.m_needsRenderLastFrame = true;
            }

            const animationTime = this.m_panAnimationTime / this.panInertiaDampingDuration;
            this.m_currentInertialPanningSpeed = this.easeOutCubic(
                this.m_lastAveragedPanDistance,
                0,
                Math.min(1, animationTime)
            );
            if (this.m_currentInertialPanningSpeed === 0) {
                this.m_lastAveragedPanDistance = 0;
            }
            this.m_panDistanceFrameDelta
                .copy(this.m_lastPanVector)
                .setLength(this.m_currentInertialPanningSpeed);
        } else {
            this.m_lastPanVector.copy(this.m_panDistanceFrameDelta);
            const panDistance = this.m_lastPanVector.length();
            this.m_currentPanDistanceIndex =
                (this.m_currentPanDistanceIndex + 1) % USER_INPUTS_TO_CONSIDER;
            this.m_recentPanDistances[this.m_currentPanDistanceIndex] = panDistance;
            this.m_lastAveragedPanDistance =
                this.m_recentPanDistances.reduce((a, b) => a + b) / USER_INPUTS_TO_CONSIDER;
        }

        MapViewUtils.pan(
            this.mapView,
            this.m_panDistanceFrameDelta.x,
            this.m_panDistanceFrameDelta.y
        );
        if (!applyInertia) {
            this.m_panDistanceFrameDelta.set(0, 0, 0);
        }

        this.updateMapView();
    }

    private bindInputEvents(domElement: HTMLCanvasElement) {
        const onContextMenu = this.contextMenu.bind(this);
        const onMouseDown = this.mouseDown.bind(this);
        const onMouseWheel = this.mouseWheel.bind(this);
        const onTouchStart = this.touchStart.bind(this);
        const onTouchEnd = this.touchEnd.bind(this);
        const onTouchMove = this.touchMove.bind(this);

        domElement.addEventListener("contextmenu", onContextMenu, false);
        domElement.addEventListener("mousedown", onMouseDown, false);
        domElement.addEventListener("wheel", onMouseWheel, false);
        domElement.addEventListener("touchstart", onTouchStart, false);
        domElement.addEventListener("touchend", onTouchEnd, false);
        domElement.addEventListener("touchmove", onTouchMove, false);

        this.dispose = () => {
            domElement.removeEventListener("contextmenu", onContextMenu, false);
            domElement.removeEventListener("mousedown", onMouseDown, false);
            domElement.removeEventListener("wheel", onMouseWheel, false);
            domElement.removeEventListener("touchstart", onTouchStart, false);
            domElement.removeEventListener("touchend", onTouchEnd, false);
            domElement.removeEventListener("touchmove", onTouchMove, false);
        };
    }

    private updateMapView() {
        this.dispatchEvent(MAPCONTROL_EVENT);
        this.mapView.update();
    }

    private mouseDown(event: MouseEvent) {
        if (this.enabled === false) {
            return;
        }

        if (event.shiftKey || event.ctrlKey) {
            return;
        }

        event.stopPropagation();

        if (this.m_state !== State.NONE) {
            return;
        }

        if (event.button === 0) {
            this.m_state = State.PAN;
        } else if (event.button === 1) {
            this.m_state = State.ROTATE;
        } else if (event.button === 2 && this.tiltEnabled) {
            this.m_state = State.ORBIT;
        } else {
            return;
        }

        this.dispatchEvent(MAPCONTROL_EVENT_BEGIN_INTERACTION);

        this.m_lastMousePosition.setX(event.clientX);
        this.m_lastMousePosition.setY(event.clientY);

        const onMouseMove = this.mouseMove.bind(this);
        const onMouseUp = this.mouseUp.bind(this);

        window.addEventListener("mousemove", onMouseMove, false);
        window.addEventListener("mouseup", onMouseUp, false);

        this.m_cleanupMouseEventListeners = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }

    private mouseMove(event: MouseEvent) {
        if (this.enabled === false) {
            return;
        }

        this.m_mouseDelta.set(
            event.clientX - this.m_lastMousePosition.x,
            event.clientY - this.m_lastMousePosition.y
        );

        if (this.m_state === State.PAN) {
            this.panFromTo(
                this.m_lastMousePosition.x,
                this.m_lastMousePosition.y,
                event.clientX,
                event.clientY
            );
        } else if (this.m_state === State.ROTATE) {
            this.rotate(
                -this.rotationMouseDeltaFactor * this.m_mouseDelta.x,
                this.rotationMouseDeltaFactor * this.m_mouseDelta.y
            );
        } else if (this.m_state === State.ORBIT) {
            this.orbitFocusPoint(
                this.orbitingMouseDeltaFactor * this.m_mouseDelta.x,
                -this.orbitingMouseDeltaFactor * this.m_mouseDelta.y
            );
        }

        this.m_lastMousePosition.setX(event.clientX);
        this.m_lastMousePosition.setY(event.clientY);
        this.m_zoomAnimationStartTime = performance.now();

        this.updateMapView();
        event.preventDefault();
        event.stopPropagation();
    }

    private mouseUp(event: MouseEvent) {
        if (this.enabled === false) {
            return;
        }

        this.updateMapView();

        event.preventDefault();
        event.stopPropagation();

        this.m_state = State.NONE;

        if (this.m_cleanupMouseEventListeners) {
            this.m_cleanupMouseEventListeners();
        }

        this.dispatchEvent(MAPCONTROL_EVENT_END_INTERACTION);
    }

    private mouseWheel(event: WheelEvent) {
        const { width, height } = utils.getWidthAndHeightFromCanvas(this.domElement);
        const screenTarget = utils.calculateNormalizedDeviceCoordinates(
            event.offsetX,
            event.offsetY,
            width,
            height
        );

        this.setZoomLevel(
            this.zoomLevelTargeted + this.zoomLevelDeltaOnMouseWheel * (event.deltaY > 0 ? -1 : 1),
            screenTarget
        );

        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * Calculates the angle of the vector, which is formed by two touch points in world space
     * against the X axis in world space on the map. The resulting angle is in radians and between
     * `-PI` and `PI`.
     */
    private calculateAngleFromTouchPointsInWorldspace(): number {
        if (this.m_touchState.touches.length < 2) {
            return 0;
        }

        const x =
            this.m_touchState.touches[1].currentWorldPosition.x -
            this.m_touchState.touches[0].currentWorldPosition.x;

        const y =
            this.m_touchState.touches[1].currentWorldPosition.y -
            this.m_touchState.touches[0].currentWorldPosition.y;

        return Math.atan2(y, x);
    }

    /**
     * Calculates the difference of the current distance of two touch points against their initial
     * distance in world space.
     */
    private calculatePinchDistanceInWorldSpace(): number {
        if (this.m_touchState.touches.length < 2) {
            return 0;
        }

        const initialDistance = this.m_tmpVector3
            .subVectors(
                this.m_touchState.touches[0].initialWorldPosition,
                this.m_touchState.touches[1].initialWorldPosition
            )
            .length();

        const currentDistance = this.m_tmpVector3
            .subVectors(
                this.m_touchState.touches[0].currentWorldPosition,
                this.m_touchState.touches[1].currentWorldPosition
            )
            .length();

        return currentDistance - initialDistance;
    }

    private convertTouchPoint(touch: Touch): TouchState | null {
        const newTouchPoint = new THREE.Vector2(touch.pageX, touch.pageY);

        const { width, height } = utils.getWidthAndHeightFromCanvas(this.domElement);

        const touchPointInNDC = utils.calculateNormalizedDeviceCoordinates(
            newTouchPoint.x,
            newTouchPoint.y,
            width,
            height
        );
        const newWorldPosition = MapViewUtils.rayCastWorldCoordinates(
            this.mapView,
            touchPointInNDC.x,
            touchPointInNDC.y
        );

        if (newWorldPosition === null) {
            return null;
        }

        return {
            currentTouchPoint: newTouchPoint,
            lastTouchPoint: newTouchPoint,
            currentWorldPosition: newWorldPosition,
            initialWorldPosition: newWorldPosition
        };
    }

    private setTouchState(touches: TouchList) {
        this.m_touchState.touches = [];

        // TouchList doesn't conform to iterator interface so we cannot use 'for of'
        // tslint:disable-next-line:prefer-for-of
        for (let i = 0; i < touches.length; ++i) {
            const touchState = this.convertTouchPoint(touches[i]);
            if (touchState) {
                this.m_touchState.touches.push(touchState);
            }
        }

        if (this.m_touchState.touches.length !== 0) {
            this.updateTouchState();
            this.m_touchState.initialRotation = this.m_touchState.currentRotation;
        }
    }

    private updateTouchState() {
        this.m_touchState.currentRotation = this.calculateAngleFromTouchPointsInWorldspace();
    }

    private updateTouches(touches: TouchList) {
        const length = Math.min(touches.length, this.m_touchState.touches.length);
        for (let i = 0; i < length; ++i) {
            const oldTouchState = this.m_touchState.touches[i];
            const newTouchState = this.convertTouchPoint(touches[i]);
            if (newTouchState !== null) {
                newTouchState.initialWorldPosition = oldTouchState.initialWorldPosition;
                newTouchState.lastTouchPoint = oldTouchState.currentTouchPoint;
                this.m_touchState.touches[i] = newTouchState;
            }
        }
    }

    private touchStart(event: TouchEvent) {
        if (this.enabled === false) {
            return;
        }

        this.m_state = State.TOUCH;

        this.dispatchEvent(MAPCONTROL_EVENT_BEGIN_INTERACTION);
        this.setTouchState(event.touches);

        event.preventDefault();
        event.stopPropagation();
    }

    private touchMove(event: TouchEvent) {
        if (this.enabled === false) {
            return;
        }

        this.updateTouches(event.touches);
        this.updateTouchState();

        if (this.m_touchState.touches.length <= 2) {
            this.m_panDistanceFrameDelta.subVectors(
                this.m_touchState.touches[0].initialWorldPosition,
                this.m_touchState.touches[0].currentWorldPosition
            );

            // Cancel zoom inertia if a panning is triggered, so that the mouse location is kept.
            this.m_startZoom = this.m_targetedZoom = this.currentZoom;

            // Assign the new animation start time.
            this.m_panAnimationStartTime = performance.now();

            this.pan();
        }

        if (this.m_touchState.touches.length === 2) {
            const deltaRotation =
                this.m_touchState.currentRotation - this.m_touchState.initialRotation;
            this.rotate(geoUtils.MathUtils.radToDeg(deltaRotation), 0);
            this.moveAlongTheViewDirection(this.calculatePinchDistanceInWorldSpace());
        }

        if (this.m_touchState.touches.length === 3 && this.tiltEnabled) {
            const firstTouch = this.m_touchState.touches[0];
            const diff = this.m_tmpVector2.subVectors(
                firstTouch.currentTouchPoint,
                firstTouch.lastTouchPoint
            );

            this.orbitFocusPoint(
                this.orbitingTouchDeltaFactor * diff.x,
                -this.orbitingTouchDeltaFactor * diff.y
            );
        }

        this.m_zoomAnimationStartTime = performance.now();

        this.updateMapView();
        event.preventDefault();
        event.stopPropagation();
    }

    private touchEnd(event: TouchEvent) {
        if (this.enabled === false) {
            return;
        }
        this.m_state = State.NONE;

        this.setTouchState(event.touches);

        this.dispatchEvent(MAPCONTROL_EVENT_END_INTERACTION);
        this.updateMapView();

        event.preventDefault();
        event.stopPropagation();
    }

    private contextMenu(event: Event) {
        event.preventDefault();
    }

    private panFromTo(fromX: number, fromY: number, toX: number, toY: number): void {
        const { width, height } = utils.getWidthAndHeightFromCanvas(this.domElement);

        const from = utils.calculateNormalizedDeviceCoordinates(fromX, fromY, width, height);
        const to = utils.calculateNormalizedDeviceCoordinates(toX, toY, width, height);

        let toWorld: THREE.Vector3 | undefined;
        let fromWorld: THREE.Vector3 | undefined;
        if (this.mapView.elevationProvider === undefined) {
            fromWorld = MapViewUtils.rayCastWorldCoordinates(this.mapView, from.x, from.y);
            toWorld = MapViewUtils.rayCastWorldCoordinates(this.mapView, to.x, to.y);
        } else {
            fromWorld = this.mapView.elevationProvider.rayCast(fromX, fromY);
            if (fromWorld === undefined) {
                return;
            }
            const fromGeoAltitude = this.mapView.projection.unprojectAltitude(fromWorld);

            // We can ensure that points under the mouse stay there by projecting the to point onto
            // a plane with the altitude based on the initial point.
            // Todo: Check this works for spherical panning.
            toWorld = MapViewUtils.rayCastWorldCoordinates(
                this.mapView,
                to.x,
                to.y,
                fromGeoAltitude
            );
        }

        if (toWorld === undefined || fromWorld === undefined) {
            return;
        }

        if (this.mapView.projection.type === geoUtils.ProjectionType.Planar) {
            // Cancel zoom inertia if a panning is triggered, so that the mouse location is kept.
            this.stopZoom();

            // Assign the new animation start time.
            this.m_panAnimationStartTime = performance.now();

            this.m_panDistanceFrameDelta = fromWorld.sub(toWorld);

            this.pan();
        } else {
            quaternion.setFromUnitVectors(fromWorld.normalize(), toWorld.normalize()).inverse();
            matrix.copyPosition(this.camera.matrix).makeRotationFromQuaternion(quaternion);
            this.camera.applyMatrix(matrix);
        }
    }

    private constrainPitchAngle(pitchAngle: number, deltaPitch: number): number {
        const tmpPitchAngle = geoUtils.MathUtils.clamp(
            pitchAngle + deltaPitch,
            this.m_minPitchAngle,
            this.m_maxPitchAngle
        );
        if (
            this.tiltEnabled &&
            tmpPitchAngle <= this.m_maxPitchAngle &&
            tmpPitchAngle >= this.m_minPitchAngle
        ) {
            pitchAngle = tmpPitchAngle;
        }
        return pitchAngle;
    }

    /**
     * This method approximates the minimum delta altitude by attempts. It has been preferred over a
     * solution where the minimum delta is calculated adding the new delta to the current delta,
     * because that solution would not have worked with terrains.
     */
    private getMinDelta(deltaAltitude: number): number {
        // Do not even start to calculate a delta if the camera is already under the minimum height.
        if (this.mapView.camera.position.z < this.minCameraHeight && deltaAltitude > 0) {
            return 0;
        }

        const checkMinCamHeight = (deltaAlt: number, camera: THREE.PerspectiveCamera) => {
            const cameraPos = camera.position;
            const cameraQuat = camera.quaternion;
            const newPitchQuaternion = new THREE.Quaternion();
            const viewDirection = new THREE.Vector3();
            const mockCamera = new THREE.Object3D();
            mockCamera.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
            mockCamera.quaternion.set(cameraQuat.x, cameraQuat.y, cameraQuat.z, cameraQuat.w);

            // save the current direction of the camera in viewDirection
            mockCamera.getWorldDirection(viewDirection);

            //calculate the new azimuth and altitude
            const currentAzimuthAltitude = utils.directionToAzimuthAltitude(viewDirection);
            const topElevation =
                (1.0 / Math.sin(currentAzimuthAltitude.altitude)) * mockCamera.position.z;

            // get the current quaternion from the camera
            const yawPitchRoll = MapViewUtils.extractYawPitchRoll(mockCamera.quaternion);

            //calculate the pitch
            const deltaPitchRadians = geoUtils.MathUtils.degToRad(deltaAlt);
            const pitchAngle = this.constrainPitchAngle(yawPitchRoll.pitch, deltaPitchRadians);
            newPitchQuaternion.setFromAxisAngle(pitchAxis, pitchAngle);

            // update the camera and the viewDirection vector
            mockCamera.quaternion.copy(newPitchQuaternion);
            mockCamera.matrixWorldNeedsUpdate = true;
            mockCamera.getWorldDirection(viewDirection);

            // use the viewDirection to get the height
            const newAzimuthAltitude = utils.directionToAzimuthAltitude(viewDirection);
            const newElevation = Math.sin(newAzimuthAltitude.altitude) * topElevation;
            return newElevation;
        };

        let constrainedDeltaAltitude = deltaAltitude;
        for (let i = 0; i < MAX_DELTA_ALTITUDE_STEPS; i++) {
            const cameraHeight = checkMinCamHeight(constrainedDeltaAltitude, this.mapView.camera);
            if (cameraHeight < this.minCameraHeight) {
                constrainedDeltaAltitude *= 0.5;
            } else {
                return constrainedDeltaAltitude;
            }
        }
        return constrainedDeltaAltitude;
    }
}
