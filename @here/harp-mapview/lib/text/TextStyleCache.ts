/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedTechniqueParams, Technique } from "@here/harp-datasource-protocol";
import {
    FontUnit,
    HorizontalAlignment,
    TextLayoutStyle,
    TextRenderStyle,
    VerticalAlignment
} from "@here/harp-text-canvas";
import { ColorCache } from "../ColorCache";

/**
 * [[TextStyle]] id for the default value inside a [[TextRenderStyleCache]] or a
 * [[TextLayoutStyleCache]].
 */
export const DEFAULT_TEXT_STYLE_CACHE_ID = "Default";

/**
 * Calculates the [[TextStyle]] id that identifies either a [[TextRenderStyle]] or a
 * [[TextLayoutStyle]] inside a [[TextRenderStyleCache]] or a [[TextLayoutStyleCache]],
 * respectively.
 *
 * @param technique Technique defining the [[TextStyle]].
 * @param zoomLevel Zoom level for which to interpret the technique.
 *
 * @returns [[TextStyle]] id.
 */
export function computeStyleCacheId(
    datasourceName: string,
    technique: Technique & Partial<IndexedTechniqueParams>,
    zoomLevel: number
): string {
    return `${datasourceName}_${technique._styleSetIndex}_${zoomLevel}`;
}

/**
 * Cache storing [[MapView]]'s [[TextRenderStyle]]s.
 */
export class TextRenderStyleCache {
    private m_map: Map<string, TextRenderStyle> = new Map();
    constructor() {
        this.m_map.set(
            DEFAULT_TEXT_STYLE_CACHE_ID,
            new TextRenderStyle({
                fontSize: {
                    unit: FontUnit.Pixel,
                    size: 32,
                    backgroundSize: 8
                },
                color: ColorCache.instance.getColor("#6d7477"),
                backgroundColor: ColorCache.instance.getColor("#f7fbfd"),
                backgroundOpacity: 0.5
            })
        );
    }

    get size(): number {
        return this.m_map.size;
    }

    get(id: string): TextRenderStyle | undefined {
        return this.m_map.get(id);
    }

    set(id: string, value: TextRenderStyle): void {
        this.m_map.set(id, value);
    }

    clear(): void {
        this.m_map.clear();
        this.m_map.set(
            DEFAULT_TEXT_STYLE_CACHE_ID,
            new TextRenderStyle({
                fontSize: {
                    unit: FontUnit.Pixel,
                    size: 32,
                    backgroundSize: 8
                },
                color: ColorCache.instance.getColor("#6d7477"),
                backgroundColor: ColorCache.instance.getColor("#f7fbfd"),
                backgroundOpacity: 0.5
            })
        );
    }
}

/**
 * Cache storing [[MapView]]'s [[TextLayoutStyle]]s.
 */
export class TextLayoutStyleCache {
    private m_map: Map<string, TextLayoutStyle> = new Map();
    constructor() {
        this.m_map.set(
            DEFAULT_TEXT_STYLE_CACHE_ID,
            new TextLayoutStyle({
                verticalAlignment: VerticalAlignment.Center,
                horizontalAlignment: HorizontalAlignment.Center
            })
        );
    }

    get size(): number {
        return this.m_map.size;
    }

    get(id: string): TextLayoutStyle | undefined {
        return this.m_map.get(id);
    }

    set(id: string, value: TextLayoutStyle): void {
        this.m_map.set(id, value);
    }

    clear(): void {
        this.m_map.clear();
        this.m_map.set(
            DEFAULT_TEXT_STYLE_CACHE_ID,
            new TextLayoutStyle({
                verticalAlignment: VerticalAlignment.Center,
                horizontalAlignment: HorizontalAlignment.Center
            })
        );
    }
}
