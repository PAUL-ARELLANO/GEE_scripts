//Google Earth Engine Script
// This script processes Sentinel-2 imagery to compute NDVI for specified polygons in Arizona.
// It includes steps for data filtering, cloud masking, annual NDVI composites, trend analysis,
// and exporting results as GeoTIFFs. The script is designed to handle multiple years of data
// and provides visualizations for the computed NDVI values.
// The Study Areas are defined by polygons imported from an asset.
// 
// Date: Jun 24th, 2025
//
//By: Paul Arellan - Paul Gee 
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
var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority1_WGS84_Arizona_4_2");
// Define the study area as the union of all polygon geometries.
var studyArea = polygons.geometry();

// Center the map on your polygons and add a layer to visualize them.
Map.centerObject(polygons, 8); // Adjust zoom level if needed
Map.addLayer(polygons, {color: 'FF0000'}, 'Priority Polygons');


// Check for ANY Sentinel-2 data for the study areas in 2023 ---
print('--- DIAGNOSTIC: Checking raw data availability for 2023 ---');
var rawS2_2023 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(studyArea)
  .filterDate('2023-01-01', '2023-12-31'); // Filter for the ENTIRE year 2023

print('Raw Sentinel-2 images for 2023 (full year, no cloud filter):', rawS2_2023.size());

// Visualiztion of  he first image from this raw collection (will be cloudy/hazy?)
var firstRawS2_2023 = rawS2_2023.first();
if (firstRawS2_2023) {
  // Scale raw bands for visualization (they are typically ints 0-10000)
  var visParamsRaw = {bands: ['B4', 'B3', 'B2'], min: 0, max: 2000};
  Map.addLayer(firstRawS2_2023.clip(studyArea), visParamsRaw, 'First Raw S2 2023 (clipped)');
  print('First Raw S2 image for 2023 (clipped for inspection):', firstRawS2_2023.clip(studyArea));
} else {
  print('WARNING: No raw Sentinel-2 images found for this polygon in 2023, even for the full year and no cloud filter.');
}
print('----------------------------------------------------');


// --- 2. DATA FILTERING AND CLOUD MASKING (from previous script, keep this for now) ---

var sentinel2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(studyArea) // Filter by the combined study area
  .filterDate('2023-03-01', '2024-09-30') // Overall date range for your analysis
  //.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 80)); // THIS LINE REMAINS COMMENTED OUT for now

// Print the initial collection size (after initial filters).
print('Initial Sentinel-2 Collection Size (before mask):', sentinel2.size());

// Function to mask clouds using QA60 and SCL bands (Sentinel-2 L2A). This function may be usefull for winter and fall seasons
//function maskS2clouds(image) {
//  var qa = image.select('QA60');
//  var cloudBitMask = 1 << 10;
//  var cirrusBitMask = 1 << 11;

//  var qa_mask = qa.bitwiseAnd(cloudBitMask).eq(0)
//    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

//  var scl = image.select('SCL');
//  var scl_mask = scl.neq(10) // Mask cirrus
//                 .and(scl.neq(11)) // Mask saturated/defective
                 // Keeping these commented out as per our last debugging attempt:
                 // .and(scl.neq(3))  // Mask cloud shadows
                 // .and(scl.neq(8))  // Mask clouds medium probability
//                 .and(scl.neq(9));   // Mask clouds high probability

//  var combinedMask = qa_mask.and(scl_mask);

//  return image.updateMask(combinedMask)
//    .select(['B8', 'B4', 'B2', 'B3', 'B11', 'B12'])
//    .divide(10000);
//}

// Apply the cloud masking function to the Sentinel-2 collection.
//sentinel2 = sentinel2.map(maskS2clouds);

// Print the collection size after cloud masking (size remains same, but pixels are masked).
print('Filtered Sentinel-2 Collection Size (after mask):', sentinel2.size());

// --- Inspect individual masked Sentinel-2 images (clipped to studyArea) ---
var firstMaskedS2 = sentinel2.first();
if (firstMaskedS2) {
  var clippedFirstMaskedS2 = firstMaskedS2.clip(studyArea);
  Map.addLayer(clippedFirstMaskedS2.select(['B4', 'B3', 'B2']), {min: 0.05, max: 0.25}, 'First Masked S2 RGB (clipped)');
  Map.addLayer(clippedFirstMaskedS2.select('B8'), {min: 0.05, max: 0.4}, 'First Masked S2 NIR (clipped)');
  print('First masked S2 image (clipped for inspection):', clippedFirstMaskedS2);
} else {
  print('Warning: No images in sentinel2 collection after initial filtering and masking!');
}


// --- 3. COMPUTE NDVI ---

function computeNDVI(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return image.addBands(ndvi);
}

var ndviCollection = sentinel2.map(computeNDVI);

print('NDVI Collection Size:', ndviCollection.size());

var firstNDVI = ndviCollection.select('NDVI').first();
if (firstNDVI) {
  var clippedFirstNDVI = firstNDVI.clip(studyArea);
  Map.addLayer(clippedFirstNDVI, {min: 0, max: 0.8, palette: ['red', 'yellow', 'green']}, 'First NDVI (individual, clipped)');
  print('First NDVI image (clipped for inspection):', clippedFirstNDVI);
} else {
  print('Warning: No NDVI images in collection. Check previous steps.');
}


// --- 4. COMPUTE ANNUAL NDVI COMPOSITES (Spring/Summer, with robust band checks) ---

var years = ee.List.sequence(2023, 2024);

var yearlyNDVI = years.map(function(year) {
  year = ee.Number(year);
  var springSummerStartDate = ee.Date.fromYMD(year, 3, 1); // March 1st
  var springSummerEndDate = ee.Date.fromYMD(year, 6, 17);   // Jun 17st

  var collectionForYear = ndviCollection.filterDate(springSummerStartDate, springSummerEndDate).select('NDVI');
  var numImagesInYear = collectionForYear.size();

  // Calculate 95th percentile composite instead of median
  // The input to .reduce is collectionForYear which has only the 'NDVI' band.
  // The output band from percentile reducer will be 'NDVI_p95'.
  var tempComposite = collectionForYear.reduce(ee.Reducer.percentile([95]));
  var p95BandName = ee.String('NDVI_p95'); // Expected output band name

  // Rename the percentile band to 'NDVI' for consistency if it exists.
  // If tempComposite has no bands (e.g., collectionForYear was empty),
  // this will result in an image with no bands.
  var composite = ee.Image(ee.Algorithms.If(
      tempComposite.bandNames().contains(p95BandName),
      tempComposite.select([p95BandName], ['NDVI']), // Select the p95 band and rename it to NDVI
      ee.Image() // An empty image if no p95 band
  ));
  composite = ee.Image(composite);

  var defaultImage = ee.Image.constant(0).rename('NDVI')
    .set('system:time_start', springSummerStartDate.millis())
    .set('system:time_end', springSummerEndDate.millis())
    .clip(studyArea);

  var compositeHasBands = composite.bandNames().size().gt(0);
  // If compositeHasBands is true, 'composite' now contains the 'NDVI' band (renamed from 'NDVI_p95').
  // If false, 'composite' is an empty image (0 bands), and defaultImage will be used.

  var baseImage = ee.Algorithms.If(
      compositeHasBands,
      composite.clip(studyArea),
      defaultImage
  );
  baseImage = ee.Image(baseImage);

  var countDict = ee.Algorithms.If(
      baseImage.bandNames().contains('NDVI'),
      baseImage.mask().reduceRegion({
          reducer: ee.Reducer.count(),
          geometry: studyArea,
          scale: 30,
          tileScale: 16
      }),
      ee.Dictionary({})
  );
  countDict = ee.Dictionary(countDict);
  var hasKey = countDict.keys().contains('NDVI');
  var hasUnmaskedPixels = ee.Algorithms.If(
      hasKey,
      countDict.get('NDVI'),
      ee.Number(0)
  );
  var resultHasData = ee.Number(hasUnmaskedPixels).gt(0);

  var finalResultImage = ee.Algorithms.If(
    resultHasData,
    baseImage,
    defaultImage
  );
  finalResultImage = ee.Image(finalResultImage);

  return finalResultImage
    .set('year', year)
    .set('system:time_start', springSummerStartDate.millis())
    .set('system:time_end', springSummerEndDate.millis())
    .set('num_images_in_composite', numImagesInYear)
    .set('has_data_in_polygons', resultHasData) // This 'composite' is after potential renaming
    .set('composite_band_names_pre_clip', composite.bandNames()) // Bands of the image that was candidate for baseImage (either p95 renamed or empty)
    .set('base_image_band_names', baseImage.bandNames())
    .set('final_image_band_names', finalResultImage.bandNames());
});

yearlyNDVI = ee.ImageCollection(yearlyNDVI);
print('Yearly NDVI ImageCollection (Spring/Summer):', yearlyNDVI);


// --- 5. VISUALIZATION OF YEARLY COMPOSITES ---

var vizParams = { min: 0, max: 1, palette: ['red', 'yellow', 'green'] };

var ndvi2023 = yearlyNDVI.filter(ee.Filter.eq('year', 2023)).first();
if (ndvi2023) {
  Map.addLayer(ndvi2023, vizParams, 'NDVI 2023 Composite');
  print('NDVI 2023 Composite image (for properties check):', ndvi2023);
} else {
  print('Warning: No 2023 NDVI composite found for visualization.');
}

var ndvi2024 = yearlyNDVI.filter(ee.Filter.eq('year', 2024)).first();
if (ndvi2024) {
  Map.addLayer(ndvi2024, vizParams, 'NDVI 2024 Composite');
  print('NDVI 2024 Composite image (for properties check):', ndvi2024);
} else {
  print('Warning: No 2024 NDVI composite found for visualization.');
}

// --- 6. COMPUTE NDVI TREND ---

var ndviTrend = yearlyNDVI.map(function(image) {
  var year = ee.Number(image.get('year'));
  var xBand = ee.Image.constant(year).rename('x').toFloat();
  var yBand = image.select('NDVI').rename('y');
  return xBand.addBands(yBand);
}).reduce(ee.Reducer.linearFit());

var clippedNdviTrend = ee.Algorithms.If(
  ndviTrend && ndviTrend.bandNames().contains('scale'),
  ndviTrend.clip(studyArea),
  ee.Image.constant(0).rename('scale').clip(studyArea)
);
ndviTrend = ee.Image(clippedNdviTrend);

print('NDVI Trend Image (slope and offset):', ndviTrend);

if (ndviTrend && ndviTrend.bandNames().contains('scale')) {
  Map.addLayer(ndviTrend.select('scale'), { min: -0.05, max: 0.05, palette: ['blue', 'white', 'green'] }, 'NDVI Trend (Slope)');
} else {
  print('Warning: NDVI Trend image does not have "scale" band for visualization or is null.');
}


// --- 7. EXTRACT NDVI PER POLYGON (Mean Statistics) ---

var ndviStats = yearlyNDVI.map(function(image) {
  return image.select('NDVI').reduceRegions({
    collection: polygons,
    reducer: ee.Reducer.mean(),
    scale: 30,
    tileScale: 4
  }).map(function(f) {
    return f.set('year', image.get('year'));
  });
}).flatten();

print('NDVI Statistics per Polygon:', ndviStats);


// --- 8. COMPUTE AND EXPORT PER-POLYGON NDVI TREND STATISTICS ---

print('--- Computing Per-Polygon NDVI Trend Statistics ---');

// Function to calculate linear trend statistics for a single polygon
var calculatePolygonTrend = function(polygonFeature) {
  // Attempt to get a unique identifier for the polygon for chart titles and data.
  // Adjust property names like 'Name' or 'PolygonID' if yours are different.
  var polygonId = ee.String(polygonFeature.id()); // Default to system:index
  polygonId = ee.Algorithms.If(polygonFeature.get('Name'), ee.String(polygonFeature.get('Name')), polygonId);
  // Create a time series of mean NDVI for this polygon
  var perPolygonTimeSeries = yearlyNDVI.map(function(image) {
    var year = image.getNumber('year'); // Independent variable (x)
    
    // Calculate mean NDVI within the polygon for the current year's composite
    var meanNdviInPolygon = image.select('NDVI').reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: polygonFeature.geometry(),
      scale: 30,
      maxPixels: 1e9, // Max pixels to process in the region
      tileScale: 4    // Use a tileScale consistent with other reductions
    }).get('NDVI');   // Dependent variable (y)

    return ee.Feature(null, {
      'polygon_id': polygonId, // Add polygon identifier to each time series point
      // year is already an ee.Number from getNumber('year')
      'year': year,          // Property for the independent variable (renamed for clarity)
      'ndvi_y': meanNdviInPolygon // Property for the dependent variable
    });
  });

  // Filter out any features where ndvi_y might be null (e.g., no valid pixels in polygon for a year)
  perPolygonTimeSeries = perPolygonTimeSeries.filter(ee.Filter.notNull(['year', 'ndvi_y']));

  // The perPolygonTimeSeries now contains the raw data points for trend calculation for this polygon.
  // We will export this collection later, flattened for all polygons.

  // --- Calculate Trend Stats (slope/offset) for this polygon ---
  var seriesSize = perPolygonTimeSeries.size();
  var defaultFit = ee.Dictionary({scale: null, offset: null}); // Default if not enough data

  var trendStats = ee.Algorithms.If(
    seriesSize.gte(2),
    // Apply linear fit. Selectors are [independent_var_property, dependent_var_property]
    perPolygonTimeSeries.reduceColumns({
      reducer: ee.Reducer.linearFit(), 
      selectors: ['year', 'ndvi_y'] // Output is a dictionary with 'scale' and 'offset'
    }),
    defaultFit // Use default if not enough points
  );
  trendStats = ee.Dictionary(trendStats); // Cast the result of ee.Algorithms.If

  // Return the original polygon feature with new properties for slope and offset
  return polygonFeature.set({
    'polygon_id_prop': polygonId, // Store the ID used
    'NDVI_slope': trendStats.get('scale'),
    'NDVI_offset': trendStats.get('offset'),
    'trend_points_used': seriesSize // Number of years used in the trend calculation for this polygon
    // We are not attaching 'time_series_data' directly here anymore for the main collection,
    // as charts will be generated on the fly.
  });
};

var polygonsWithTrendStats = polygons.map(calculatePolygonTrend);

print('Per-Polygon NDVI Trend Statistics:', polygonsWithTrendStats);

// Export the per-polygon trend statistics as a CSV file
// This CSV contains one row per polygon with its slope, offset, etc.
Export.table.toDrive({
  collection: polygonsWithTrendStats,
  description: 'NDVI_Trend_Stats_Per_Polygon_SpringSummer',
  fileNamePrefix: 'NDVI_Trend_Stats_Per_Polygon_SpringSummer',
  fileFormat: 'CSV',
  selectors: ['polygon_id_prop', 'NDVI_slope', 'NDVI_offset', 'trend_points_used'] // Add original polygon ID properties if needed
});


// --- 9. NDVI TREND PLOT (Time-Series Chart for overall study area) ---
print('--- Generating NDVI Trend Plots (Overall and Per Polygon) ---');

// --- 9.1 Overall Trend Chart for the entire study area ---
var overallTrendChart = ui.Chart.image.series({
  imageCollection: yearlyNDVI.select('NDVI'),
  region: polygons.geometry(),
  reducer: ee.Reducer.mean(),
  scale: 30,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Overall Study Area NDVI Trend (Mean)',
  vAxis: { title: 'NDVI' },
  hAxis: { title: 'Year', format: 'yyyy' },
  lineWidth: 1,
  pointSize: 3,
});

print(overallTrendChart);

// --- 9.2 Generate and Print Individual Trend Charts for Each Polygon ---
// To generate UI charts per feature, we often need to bring feature info to the client.
polygons.evaluate(function(polygonsClientSide) {
  // polygonsClientSide is a GeoJSON FeatureCollection
  polygonsClientSide.features.forEach(function(featureGeoJSON, index) {
    var polygonFeature = ee.Feature(featureGeoJSON); // Convert GeoJSON feature back to ee.Feature

    // Get an identifier for the polygon for the chart title
    // Initialize with a fallback in case no specific properties are found
    var polygonIdentifierClient = 'Polygon ' + (index + 1); 
    
    // Attempt to get a more descriptive ID from feature properties
    // Prioritize the 'ID' field if it exists and has a meaningful value.
    if (featureGeoJSON.properties && 
        (featureGeoJSON.properties.ID !== null && typeof featureGeoJSON.properties.ID !== 'undefined' && String(featureGeoJSON.properties.ID).trim() !== '')) {
      polygonIdentifierClient = String(featureGeoJSON.properties.ID); // Ensure it's a string
    } else if (featureGeoJSON.properties && featureGeoJSON.properties.Name) { // Then check for 'Name' property
      polygonIdentifierClient = String(featureGeoJSON.properties.Name);
    } else if (featureGeoJSON.properties && featureGeoJSON.properties.PolygonID) { // Check for 'PolygonID'
      polygonIdentifierClient = String(featureGeoJSON.properties.PolygonID);
    } else if (featureGeoJSON.properties && featureGeoJSON.properties.polygon_id_prop) {
      polygonIdentifierClient = String(featureGeoJSON.properties.polygon_id_prop);
    } else if (featureGeoJSON.id) { // Fallback to GeoJSON feature's own ID if available
      polygonIdentifierClient = String(featureGeoJSON.id);
    } else {
      polygonIdentifierClient = 'Polygon (Index ' + index + ')'; // Ultimate fallback
    }


    var chartPerPolygon = ui.Chart.image.series({
      imageCollection: yearlyNDVI.select('NDVI'),
      region: polygonFeature.geometry(), // Use the individual polygon's geometry
      reducer: ee.Reducer.mean(),
      scale: 30,
      xProperty: 'system:time_start'
    }).setOptions({
      title: 'NDVI Trend - ID: ' + polygonIdentifierClient, // Prepend "ID: " for clarity
      vAxis: {title: 'NDVI'},
      hAxis: {title: 'Year', format: 'yyyy'},
      lineWidth: 1,
      pointSize: 3,
    });
    // Print only the chart widget, not the label "Chart for..." and the object details
    print(chartPerPolygon);
  });
});


// --- 10. EXPORT NDVI RESULTS AS GEOTIFFS ---

var exportNDVI = function(year) {
  var image = yearlyNDVI.filter(ee.Filter.eq('year', year)).first();
  if (image && image.bandNames().contains('NDVI')) {
    // Create an image with the desired noData value.
    // unmask() will replace masked pixels with this value.
    var imageWithNoData = image.select('NDVI').unmask(-9999);

    Export.image.toDrive({
      image: imageWithNoData,
      description: 'NDVI_SpringSummer_' + year.getInfo(),
      fileNamePrefix: 'NDVI_SpringSummer_' + year.getInfo(),
      region: studyArea.bounds(),
      scale: 30,
      fileFormat: 'GEO_TIFF', // Specify GeoTIFF format
      formatOptions: {
        cloudOptimized: true // Enable COG format
      },
      maxPixels: 1e13
    });
  } else {
    print('Skipping export for NDVI_SpringSummer_' + year.getInfo() + ': No valid composite or NDVI band found.');
  }
};

var yearsList = [2023, 2024];
yearsList.forEach(function(year) {
  exportNDVI(ee.Number(year));
});


if (ndviTrend && ndviTrend.bandNames().contains('scale')) {
  // Create an image with the desired noData value for the trend slope.
  var trendWithNoData = ndviTrend.select('scale').unmask(-9999);

  Export.image.toDrive({
    image: trendWithNoData,
    description: 'NDVI_Trend_Slope_SpringSummer',
    fileNamePrefix: 'NDVI_Trend_Slope_SpringSummer',
    region: studyArea.bounds(),
    scale: 30,
    fileFormat: 'GEO_TIFF', // Specify GeoTIFF format
    formatOptions: {
      cloudOptimized: true // Enable COG format
    },
    maxPixels: 1e13
  });
} else {
  print('Skipping export for NDVI Trend: Trend image is not valid or "scale" band is missing.');
}


// --- 11. FINAL REPORT ---

// Note: This report is generated on the client-side after all server-side tasks
// have been submitted. The execution time reflects the time for the client (your browser)
// to process the script and send tasks to GEE, not the server-side processing time for exports.

print('--- SCRIPT EXECUTION REPORT ---');

var endTime = new Date();
var durationSeconds = ee.Number((endTime.getTime() - startTime.getTime()) / 1000); // Use ee.Number for server-side operations

print('1. Total Sentinel-2 Images in Collection (after initial filters):', sentinel2.size());

// Calculate number of pixels processed in the final trend image
var processedPixels = ee.Number(0); // Default to 0
if (ndviTrend && ndviTrend.bandNames().contains('scale')) {
  var pixelCountDict = ndviTrend.select('scale').reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: studyArea, // Use the defined study area
    scale: 30, // Use the same scale as your analysis
    maxPixels: 1e13 // Ensure enough pixels can be counted for large areas
  });
  processedPixels = ee.Number(pixelCountDict.get('scale', 0)); // Get the count, use 0 as default if key is not found.
}
print('2. Number of Pixels Processed (in final trend image):', processedPixels);
print('3. Total Script Execution Time (client-side):', durationSeconds.format('%.2f').cat(' seconds')); // Format for display
print('4. GEE Clusters Used: This metric is not available to users. Earth Engine automatically manages and scales compute resources on the backend.');
print('---------------------------------');
