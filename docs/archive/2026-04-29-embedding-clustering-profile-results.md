# Embedding Clustering Profile Results

## Run 2026-04-29T18:55:29.423Z

linkage=average
threshold=0.9
gapThreshold=0
datasetSize=7697

### Size 500

```text
[profile] clustering linkage=average threshold=0.9 size=500
[profile] timings matrixBuildMs=430.03791699999965 nearestNeighborMs=1658.0558600000527 mergeUpdateMs=2.9750849999977618 gapCheckMs=0.034750000000713044 candidateScanMs=1663.963916999996 subdivisionMs=0 totalMs=2101.437833
[profile] counters activeListBuilds=22635 activeItemsVisited=9745083 nearestNeighborCalls=22418 distanceReads=9648247 distanceWrites=48006 gapChecks=108 blockedPairs=0 mergeCandidatesScanned=0 merges=108 subdivisions=0 maxActiveClusters=500 maxClusterSize=6
clusters=74
```

### Size 1000

```text
[profile] clustering linkage=average threshold=0.9 size=1000
[profile] timings matrixBuildMs=1735.784917 nearestNeighborMs=15596.987256999926 mergeUpdateMs=9.765164000005825 gapCheckMs=0.07596799998918868 candidateScanMs=15619.772007 subdivisionMs=0 totalMs=17374.310125
[profile] counters activeListBuilds=98981 activeItemsVisited=83471130 nearestNeighborCalls=98502 distanceReads=83049251 distanceWrites=210081 gapChecks=239 blockedPairs=0 mergeCandidatesScanned=0 merges=239 subdivisions=0 maxActiveClusters=1000 maxClusterSize=8
clusters=157
```

### Size 2000

```text
[profile] clustering linkage=average threshold=0.9 size=2000
[profile] timings matrixBuildMs=6861.410584000001 nearestNeighborMs=130466.29268800275 mergeUpdateMs=30.69408799988014 gapCheckMs=0.26904799993280903 candidateScanMs=130559.23219700018 subdivisionMs=0 totalMs=137483.22487499999
[profile] counters activeListBuilds=342999 activeItemsVisited=582052140 nearestNeighborCalls=342096 distanceReads=580449541 distanceWrites=799623 gapChecks=451 blockedPairs=0 mergeCandidatesScanned=0 merges=451 subdivisions=0 maxActiveClusters=2000 maxClusterSize=8
clusters=309
```

## Run 2026-04-29T19:15:54.602Z

linkage=average
threshold=0.9
gapThreshold=0.05
datasetSize=7697

### Size 500

```text
[profile] clustering linkage=average threshold=0.9 size=500
[profile] timings matrixBuildMs=452.0734169999996 nearestNeighborMs=38886.48988399914 mergeUpdateMs=1.0369580000024143 gapCheckMs=47.16336600001523 candidateScanMs=45959.14732400025 subdivisionMs=0 totalMs=46523.471792
[profile] counters activeListBuilds=444215 activeItemsVisited=214848493 nearestNeighborCalls=439327 distanceReads=369642765 distanceWrites=12623 gapChecks=2431 blockedPairs=2405 mergeCandidatesScanned=156112357 merges=26 subdivisions=0 maxActiveClusters=500 maxClusterSize=2
clusters=26
```

### Size 1000

```text
[profile] clustering linkage=average threshold=0.9 size=1000
[profile] timings matrixBuildMs=1837.8675000000003 nearestNeighborMs=686473.6254900167 mergeUpdateMs=2.9864159998542164 gapCheckMs=385.6310219960433 candidateScanMs=802483.6277179951 subdivisionMs=0 totalMs=805224.92275
[profile] counters activeListBuilds=3589335 activeItemsVisited=3445157915 nearestNeighborCalls=3568711 distanceReads=5906813056 distanceWrites=54348 gapChecks=10284 blockedPairs=10228 mergeCandidatesScanned=2472791749 merges=56 subdivisions=0 maxActiveClusters=1000 maxClusterSize=3
clusters=55
```

## Run 2026-04-29T19:36:09.234Z

linkage=complete
threshold=0.9
gapThreshold=0
datasetSize=7697

### Size 500

```text
[profile] clustering linkage=complete threshold=0.9 size=500
[profile] timings matrixBuildMs=459.48629100000016 nearestNeighborMs=1675.2051030000202 mergeUpdateMs=2.8415040000081717 gapCheckMs=0.033960999997361796 candidateScanMs=1681.4620359999817 subdivisionMs=0 totalMs=2148.2994579999995
[profile] counters activeListBuilds=21426 activeItemsVisited=9347467 nearestNeighborCalls=21227 distanceReads=9257768 distanceWrites=44451 gapChecks=99 blockedPairs=0 mergeCandidatesScanned=0 merges=99 subdivisions=0 maxActiveClusters=500 maxClusterSize=6
clusters=78
```

### Size 1000

```text
[profile] clustering linkage=complete threshold=0.9 size=1000
[profile] timings matrixBuildMs=1850.2655839999998 nearestNeighborMs=19421.172798999807 mergeUpdateMs=9.345295999981317 gapCheckMs=0.11129099998834135 candidateScanMs=19448.069587999937 subdivisionMs=0 totalMs=21316.992000000002
[profile] counters activeListBuilds=96114 activeItemsVisited=82109989 nearestNeighborCalls=95667 distanceReads=81712718 distanceWrites=197801 gapChecks=223 blockedPairs=0 mergeCandidatesScanned=0 merges=223 subdivisions=0 maxActiveClusters=1000 maxClusterSize=6
clusters=166
```

### Size 2000

```text
[profile] clustering linkage=complete threshold=0.9 size=2000
[profile] timings matrixBuildMs=7410.695750000003 nearestNeighborMs=129533.42084100468 mergeUpdateMs=30.405213999954867 gapCheckMs=0.23999799976445502 candidateScanMs=129634.4617219998 subdivisionMs=0 totalMs=137106.904584
[profile] counters activeListBuilds=322726 activeItemsVisited=555339117 nearestNeighborCalls=321891 distanceReads=553843006 distanceWrites=746430 gapChecks=417 blockedPairs=0 mergeCandidatesScanned=0 merges=417 subdivisions=0 maxActiveClusters=2000 maxClusterSize=6
clusters=324
```

## Decision Summary

| Observation           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                        | Decision Impact                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dominant timing phase | Non-gap runs are dominated by nearest-neighbor scanning: average `nearestNeighborMs=130466.29` / `candidateScanMs=130559.23` at size 2000, complete `nearestNeighborMs=129533.42` / `candidateScanMs=129634.46` at size 2000. Gap-enabled average adds very large blocked-candidate overhead: `candidateScanMs=802483.63`, `blockedPairs=10228`, `mergeCandidatesScanned=2472791749` at size 1000, while `gapCheckMs=385.63` remains secondary. | Optimize nearest-neighbor scans and active-list allocations first; for gap mode, focus next on blocked-pair / candidate-scan behavior rather than gap-check math itself.                                                              |
| Scaling shape         | Average no-gap total time grows steeply: 500 `2101.44 ms`, 1000 `17374.31 ms`, 2000 `137483.22 ms`; complete no-gap is similar: 500 `2148.30 ms`, 1000 `21316.99 ms`, 2000 `137106.90 ms`. Average with gap reaches `46523.47 ms` at 500 and `805224.92 ms` at 1000. Full-size 7697 sweeps for average, average+gap, and complete all timed out after 20 minutes.                                                                               | Pure TypeScript allocation/scan optimization is justified as the smallest next step, but current scaling is too steep to consider the existing implementation acceptable for full-size runs.                                          |
| CPU profile top frame | `profiles/embedding-clustering-average.cpuprofile`: `toSorted` `41.50%`, helper work in `consolidate-keywords-agglomerative-helpers.ts:88` `11.32%`, `pairKey` `9.70%`, `compareNearest` `7.68%`. `profiles/embedding-clustering-complete.cpuprofile`: `toSorted` `40.87%`, helper work at `:88` `11.13%`, `pairKey` `9.44%`, `compareNearest` `7.46%`.                                                                                         | Confirms the instrumentation: repeated nearest-neighbor list construction, sorting, and blocked-pair key churn dominate. Replace sort-based nearest-neighbor search with a one-pass minimum scan before considering native/WASM work. |
| Memory pressure       | Condensed Float32 distance matrix uses about `7.63 MiB` at size 2000 (`1,999,000` entries) and about `113 MiB` at size 7697 (`29,618,056` entries). No explicit GC/heap spikes were captured during these CPU-profile runs, but full-size memory remains substantial.                                                                                                                                                                           | Float32 condensed matrix still looks acceptable for TypeScript-first optimization, but memory headroom should be rechecked if full-size runs remain slow after scan/allocation fixes.                                                 |
