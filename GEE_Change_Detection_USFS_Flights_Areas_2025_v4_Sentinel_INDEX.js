//Google Earth Engine Script
// This script processes Sentinel-1 GRD imagery to assess forest health using the Radar Vegetation Index (RVI)
// for specified polygons in Arizona. It includes steps for data filtering, converting backscatter to linear power,
// calculating RVI, creating annual composites, performing trend analysis, extracting per-polygon statistics,
// and exporting results as GeoTIFFs and a CSV.
// The Study Areas are defined by polygons imported from an asset.
//
// Date: Jun 24th, 2025
//
// By: Paul Arellan - Paul Gee
// Contact:
//
// Email: paul.arellano@nau.edu
// GitHub:
//

// Record start time for performance report
var startTime = new Date();

// --- 1. SETUP: Import Polygons and Define Study Area ---

// Import your polygons asset. Ensure this path is correct.
//var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority2");
//var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority_3_WGS84_Arizona_cleaned_north");
var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority_2_WGS84_Arizona_cleaned");
// Define the study area as the union of all polygon geometries.
var studyArea = polygons.geometry();

// Center the map on your polygons and add a layer to visualize them.
Map.centerObject(polygons, 8); // Adjust zoom level if needed
Map.addLayer(polygons, {color: 'FF0000'}, 'Priority Polygons');


// --- 2. DATA ACQUISITION AND PREPARATION (SENTINEL-1) ---

// Load Sentinel-1 GRD (Ground Range Detected) data. This data is in decibels (dB).
var s1_collection = ee.ImageCollection("COPERNICUS/S1_GRD")
  .filterBounds(studyArea) // Filter by the combined study area
  .filterDate('2023-03-01', '2024-09-30') // Overall date range for your analysis
  // Filter to 'IW' (Interferometric Wide) mode, the standard mode over land.
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  // Filter to include images with both VV and VH polarizations.
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  // Filter to a single orbit pass ('ASCENDING' or 'DESCENDING') for consistent viewing geometry.
  .filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING'));

// Select the primary polarization bands to analyze.
var s1_processed = s1_collection.select(['VV', 'VH', 'angle']);

// Print the initial collection size.
print('Filtered Sentinel-1 Collection Size:', s1_processed.size());


// --- 3. CALCULATE RADAR VEGETATION INDEX (RVI) ---
// RVI is a robust indicator for vegetation structure and biomass.
// It must be calculated from backscatter in linear power scale, not dB.
// RVI = (4 * VH) / (VV + VH)

function addRVI(image) {
  // Convert dB to linear power
  var vv_lin = ee.Image(10).pow(image.select('VV').divide(10));
  var vh_lin = ee.Image(10).pow(image.select('VH').divide(10));
  
  // Calculate RVI
  // The numerator is 4 * VH
  var rvi_num = vh_lin.multiply(4);
  // The denominator is VV + VH
  var rvi_den = vv_lin.add(vh_lin);
  // RVI calculation
  var rvi = rvi_num.divide(rvi_den).rename('RVI');
  
  // The cross-polarization ratio (VH/VV) is another useful index.
  // var cross_pol_ratio = vh_lin.divide(vv_lin).rename('VH_VV_Ratio');
  
  return image.addBands(rvi);
}

var s1_with_rvi = s1_processed.map(addRVI);
print('Sentinel-1 Collection with RVI:', s1_with_rvi.first());


// --- 4. COMPUTE ANNUAL RVI COMPOSITES (Spring/Summer) ---
// Using a median reducer is a common and effective way to reduce speckle noise.

var years = ee.List.sequence(2023, 2024);

var yearlyRVI = years.map(function(year) {
  year = ee.Number(year);
  var springSummerStartDate = ee.Date.fromYMD(year, 3, 1); // March 1st
  var springSummerEndDate = ee.Date.fromYMD(year, 9, 30);   // Sep 30

  var collectionForYear = s1_with_rvi.filterDate(springSummerStartDate, springSummerEndDate).select('RVI');
  var numImagesInYear = collectionForYear.size();

  // Calculate median composite to reduce speckle.
  var composite = collectionForYear.reduce(ee.Reducer.median()).rename('RVI');

  // The following logic ensures that an image is created even if no source images were found for the year.
  var defaultImage = ee.Image.constant(0).rename('RVI') // Use a no-data value of 0 for RVI
    .set('system:time_start', springSummerStartDate.millis())
    .clip(studyArea);

  var finalResultImage = ee.Algorithms.If(
    numImagesInYear.gt(0),
    composite.clip(studyArea), // Clip the valid composite
    defaultImage
  );
  finalResultImage = ee.Image(finalResultImage);

  return finalResultImage
    .set('year', year)
    .set('system:time_start', springSummerStartDate.millis())
    .set('system:time_end', springSummerEndDate.millis())    
    .set('num_images_in_composite', numImagesInYear);
});



var yearlyRVI = ee.ImageCollection(yearlyRVI);
print('Yearly RVI ImageCollection (Spring/Summer):', yearlyRVI);


// --- 5. VISUALIZATION OF YEARLY RVI COMPOSITES ---

// RVI values typically range from 0 to 1. Higher values indicate more vegetation.
// This palette shows low RVI in red/yellow and high RVI in green.
var rviVizParams = { min: 0.2, max: 0.8, palette: ['#CE7E45', '#DF923D', '#F1B555', '#FCD163', '#99B718', '#74A901', '#66A000', '#529400', '#3E8601', '#207401', '#056201', '#004C00', '#023B01', '#012E01', '#011D01', '#011301']};

// RVI Layers
var rvi2023 = yearlyRVI.filter(ee.Filter.eq('year', 2023)).first();
Map.addLayer(rvi2023, rviVizParams, 'RVI 2023 Composite');
var rvi2024 = yearlyRVI.filter(ee.Filter.eq('year', 2024)).first();
Map.addLayer(rvi2024, rviVizParams, 'RVI 2024 Composite');


// --- 6. COMPUTE RVI TREND ---

var rviTrend = yearlyRVI.map(function(image) {
  var year = ee.Number(image.get('year'));
  var xBand = ee.Image.constant(year).rename('x').toFloat();
  var yBand = image.select('RVI').rename('y');
  return xBand.addBands(yBand);
}).reduce(ee.Reducer.linearFit()).clip(studyArea);

print('RVI Trend Image (slope and offset):', rviTrend);
// Visualize the slope of the trend. Green indicates an increasing RVI (potential growth/recovery),
// while blue indicates a decreasing RVI (potential stress/degradation).
Map.addLayer(rviTrend.select('scale'), {min: -0.1, max: 0.1, palette: ['blue', 'white', 'green']}, 'RVI Trend (Slope)');


// --- 7. EXTRACT RVI PER POLYGON & CHARTING ---

print('--- Generating RVI Trend Plots (Overall and Per Polygon) ---');

// --- 7.1 Overall Trend Chart for the entire study area ---
var overallTrendChart = ui.Chart.image.series({
  imageCollection: yearlyRVI.select('RVI'),
  region: polygons.geometry(),
  reducer: ee.Reducer.mean(),
  scale: 30, // Scale for the reduction
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Overall Study Area RVI Trend (Mean)',
  vAxis: { title: 'Mean RVI' },
  hAxis: { title: 'Year', format: 'yyyy' },
  lineWidth: 1,
  pointSize: 4,
  series: {0: {color: 'green'}}
});
print(overallTrendChart);


// --- 7.2 Per-Polygon Trend Statistics & Individual Charts ---
var calculatePolygonTrend = function(polygonFeature) {
  var polygonId = ee.String(polygonFeature.id());
  polygonId = ee.Algorithms.If(polygonFeature.get('Name'), ee.String(polygonFeature.get('Name')), polygonId);

  var perPolygonTimeSeries = yearlyRVI.map(function(image) {
    var year = image.getNumber('year');
    var meanRviInPolygon = image.select('RVI').reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: polygonFeature.geometry(),
      scale: 30,
      maxPixels: 1e9,
      tileScale: 4
    }).get('RVI');
    return ee.Feature(null, {'year': year, 'rvi_y': meanRviInPolygon});
  }).filter(ee.Filter.notNull(['year', 'rvi_y']));

  var seriesSize = perPolygonTimeSeries.size();
  var defaultFit = ee.Dictionary({scale: null, offset: null});

  var trendStats = ee.Algorithms.If(
    seriesSize.gte(2),
    perPolygonTimeSeries.reduceColumns({
      reducer: ee.Reducer.linearFit(),
      selectors: ['year', 'rvi_y']
    }),
    defaultFit
  );
  trendStats = ee.Dictionary(trendStats);

  return polygonFeature.set({
    'polygon_id_prop': polygonId,
    'RVI_slope': trendStats.get('scale'),
    'RVI_offset': trendStats.get('offset'),
    'trend_points_used': seriesSize
  });
};

var polygonsWithTrendStats = polygons.map(calculatePolygonTrend);
print('Per-Polygon RVI Trend Statistics:', polygonsWithTrendStats);

// --- 7.3 Generate and Print Individual Trend Charts for Each Polygon ---
polygons.evaluate(function(polygonsClientSide) {
  polygonsClientSide.features.forEach(function(featureGeoJSON) {
    var polygonFeature = ee.Feature(featureGeoJSON);
    var polygonIdentifierClient = 'Polygon ' + featureGeoJSON.id;
    if (featureGeoJSON.properties && featureGeoJSON.properties.Name) {
      polygonIdentifierClient = String(featureGeoJSON.properties.Name);
    }

    var chartPerPolygon = ui.Chart.image.series({
      imageCollection: yearlyRVI.select('RVI'),
      region: polygonFeature.geometry(),
      reducer: ee.Reducer.mean(),
      scale: 30,
      xProperty: 'system:time_start'
    }).setOptions({
      title: 'RVI Trend - ID: ' + polygonIdentifierClient,
      vAxis: {title: 'Mean RVI'},
      hAxis: {title: 'Year', format: 'yyyy'},
      lineWidth: 1,
      pointSize: 4,
      series: {0: {color: 'green'}}
    });
    print(chartPerPolygon);
  });
});


// --- 8. EXPORT RESULTS TO GOOGLE DRIVE ---

// --- 8.1 Export Annual RVI Composites ---
Export.image.toDrive({
  image: rvi2023,
  description: 'RVI_Composite_2023',
  folder: 'GEE_Exports_RVI',
  fileNamePrefix: 'RVI_Composite_2023',
  region: studyArea.bounds(),
  scale: 30,
  fileFormat: 'GEO_TIFF',
  formatOptions: {
    cloudOptimized: true
  },
  maxPixels: 1e13
});

Export.image.toDrive({
  image: rvi2024,
  description: 'RVI_Composite_2024',
  folder: 'GEE_Exports_RVI',
  fileNamePrefix: 'RVI_Composite_2024',
  region: studyArea.bounds(),
  scale: 30,
  fileFormat: 'GEO_TIFF',
  formatOptions: {
  cloudOptimized: true
  },
  maxPixels: 1e13
});

// --- 8.2 Export RVI Trend Slope Image ---
Export.image.toDrive({
  image: rviTrend.select('scale').unmask(-9999),
  description: 'RVI_Trend_Slope_2023-2024',
  folder: 'GEE_Exports_RVI',
  fileNamePrefix: 'RVI_Trend_Slope_2023-2024',
  region: studyArea.bounds(),
  scale: 30,
  fileFormat: 'GEO_TIFF',
  formatOptions: {
    cloudOptimized: true
  },  
  maxPixels: 1e13
});

// --- 8.3 Export Per-Polygon Statistics as CSV ---
Export.table.toDrive({
  collection: polygonsWithTrendStats,
  description: 'RVI_Trend_Stats_Per_Polygon_2023-2024',
  folder: 'GEE_Exports_RVI',
  fileNamePrefix: 'RVI_Trend_Stats_Per_Polygon_2023-2024',
  fileFormat: 'CSV',
  selectors: ['polygon_id_prop', 'RVI_slope', 'RVI_offset', 'trend_points_used']
});


print('✅ All RVI composites, trends, and stats computed. Export tasks submitted.');





