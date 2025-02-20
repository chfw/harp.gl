/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { MapEnv, ValueMap } from "@here/harp-datasource-protocol/index-decoder";
import { EarthConstants, GeoBox, TileKey } from "@here/harp-geoutils";
import { ILogger } from "@here/harp-utils";
import { Vector3 } from "three";
import { IGeometryProcessor, ILineGeometry, IPolygonGeometry, IRing } from "./IGeometryProcessor";
import { OmvFeatureFilter } from "./OmvDataFilter";
import { OmvDataAdapter } from "./OmvDecoder";
import { isArrayBufferLike, lat2tile } from "./OmvUtils";

type VTJsonPosition = [number, number];

enum VTJsonGeometryType {
    Unknown,
    Point,
    LineString,
    Polygon
}

interface VTJsonFeatureInterface {
    geometry: VTJsonPosition[] | VTJsonPosition[][];
    id: string;
    tags: ValueMap;
    type: VTJsonGeometryType;
}

interface VTJsonSourceInterface {
    geometry: number[];
    length: number;
    id: string;
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
    tags: ValueMap;
    type: string;
}

interface VTJsonTileInterface {
    features: VTJsonFeatureInterface[];
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
    numFeatures: number;
    numPoints: number;
    numSimplified: number;
    source: VTJsonSourceInterface[];
    transformed: boolean;
    x: number;
    y: number;
    z: number;
    layer: string;
}

/**
 * The class [[VTJsonDataAdapter]] converts VT-json data to geometries for the given
 * [[IGeometryProcessor]].
 */
export class VTJsonDataAdapter implements OmvDataAdapter {
    constructor(
        readonly m_processor: IGeometryProcessor,
        private m_dataFilter?: OmvFeatureFilter,
        readonly m_logger?: ILogger
    ) {}

    get dataFilter(): OmvFeatureFilter | undefined {
        return this.m_dataFilter;
    }

    set dataFilter(dataFilter: OmvFeatureFilter | undefined) {
        this.m_dataFilter = dataFilter;
    }

    canProcess(data: ArrayBufferLike | {}): boolean {
        if (isArrayBufferLike(data)) {
            return false;
        }

        const tile = data as VTJsonTileInterface;
        if (
            tile.features === undefined ||
            tile.source === undefined ||
            tile.x === undefined ||
            tile.y === undefined ||
            tile.z === undefined
        ) {
            return false;
        }

        return true;
    }

    process(tile: VTJsonTileInterface, tileKey: TileKey, geoBox: GeoBox) {
        const extent = 4096;
        const { north, west } = geoBox;
        const N = Math.log2(extent);
        const scale = Math.pow(2, tileKey.level + N);
        const top = lat2tile(north, tileKey.level + N);
        const left = ((west + 180) / 360) * scale;
        const R = EarthConstants.EQUATORIAL_CIRCUMFERENCE;

        for (const feature of tile.features) {
            const env = new MapEnv({
                ...feature.tags,
                $layer: tile.layer,
                $geometryType: this.convertGeometryType(feature.type),
                $level: tileKey.level
            });

            switch (feature.type) {
                case VTJsonGeometryType.Point: {
                    for (const pointGeometry of feature.geometry) {
                        const x = (pointGeometry as VTJsonPosition)[0];
                        const y = (pointGeometry as VTJsonPosition)[1];

                        const position = new Vector3(
                            ((left + x) / scale) * R,
                            ((top + y) / scale) * R,
                            0
                        );

                        this.m_processor.processPointFeature(
                            tile.layer,
                            [position],
                            env,
                            tileKey.level
                        );
                    }
                    break;
                }
                case VTJsonGeometryType.LineString: {
                    for (const lineGeometry of feature.geometry as VTJsonPosition[][]) {
                        const line: ILineGeometry = { positions: [] };
                        for (const [x, y] of lineGeometry) {
                            const position = new Vector3(
                                ((left + x) / scale) * R,
                                ((top + y) / scale) * R,
                                0
                            );
                            line.positions.push(position);
                        }

                        this.m_processor.processLineFeature(tile.layer, [line], env, tileKey.level);
                    }
                    break;
                }
                case VTJsonGeometryType.Polygon: {
                    let polygonValid = true;
                    const polygon: IPolygonGeometry = { rings: [] };
                    for (const outline of feature.geometry as VTJsonPosition[][]) {
                        let minX = Infinity;
                        let minY = Infinity;
                        let maxX = 0;
                        let maxY = 0;

                        const ring: IRing = { positions: [], outlines: [] };
                        for (let coordIdx = 0; coordIdx < outline.length; ++coordIdx) {
                            const currX = outline[coordIdx][0];
                            const currY = outline[coordIdx][1];
                            const nextX = outline[(coordIdx + 1) % outline.length][0];
                            const nextY = outline[(coordIdx + 1) % outline.length][1];

                            if (polygon.rings.length > 0) {
                                minX = Math.min(minX, currX);
                                minY = Math.min(minY, currY);
                                maxX = Math.max(maxX, currX);
                                maxY = Math.max(maxY, currY);
                            }

                            const position = new Vector3(
                                ((left + currX) / scale) * R,
                                ((top + currY) / scale) * R,
                                0
                            );

                            ring.positions.push(position);
                            ring.outlines!.push(
                                !(
                                    (currX === 0 && nextX === 0) ||
                                    (currX === extent && nextX === extent) ||
                                    (currY === 0 && nextY === 0) ||
                                    (currY === extent && nextY === extent)
                                )
                            );
                        }

                        if (minX === 0 && minY === 0 && maxX === extent && maxY === extent) {
                            polygonValid = false;
                            break;
                        } else {
                            minX = minY = Infinity;
                            maxX = maxY = 0;
                        }
                        polygon.rings.push(ring);
                    }

                    if (polygonValid) {
                        this.m_processor.processPolygonFeature(
                            tile.layer,
                            [polygon],
                            env,
                            tileKey.level
                        );
                    }
                    break;
                }
                case VTJsonGeometryType.Unknown: {
                    break;
                }
            }
        }
    }

    private convertGeometryType(type: VTJsonGeometryType): string {
        switch (type) {
            case VTJsonGeometryType.Point:
                return "point";
            case VTJsonGeometryType.LineString:
                return "line";
            case VTJsonGeometryType.Polygon:
                return "polygon";
            default:
                return "unknown";
        }
    }
}
