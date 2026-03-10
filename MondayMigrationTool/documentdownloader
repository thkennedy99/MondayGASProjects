/**
 * DocumentDownloader.gs - Functions for downloading documents from Monday.com
 */

/**
 * Download file from Monday.com using asset ID
 */
function downloadMondayAsset(assetId, fileName) {
  try {
    console.log('=== DOWNLOADING ASSET ===');
    console.log('Asset ID:', assetId);
    console.log('File name:', fileName);
    
    if (!assetId) {
      throw new Error('No asset ID provided');
    }
    
    // Query to get the asset's download URL
    const query = `
      query {
        assets(ids: [${assetId}]) {
          id
          name
          url
          public_url
        }
      }
    `;
    
    console.log('Querying asset with GraphQL...');
    const response = makeApiRequest(query);
    console.log('Asset query response:', JSON.stringify(response));
    
    if (!response.data || !response.data.assets || response.data.assets.length === 0) {
      throw new Error('Asset not found in Monday.com');
    }
    
    const asset = response.data.assets[0];
    console.log('Asset details:', JSON.stringify(asset));
    
    // Try to download using the URLs provided
    const urlsToTry = [asset.public_url, asset.url].filter(url => url);
    console.log('URLs to try:', urlsToTry);
    
    for (const url of urlsToTry) {
      try {
        console.log('Attempting download from:', url);
        
        const downloadResponse = UrlFetchApp.fetch(url, {
          method: 'get',
          muteHttpExceptions: true,
          followRedirects: true
        });
        
        const responseCode = downloadResponse.getResponseCode();
        console.log('Download response code:', responseCode);
        
        if (responseCode === 200) {
          const blob = downloadResponse.getBlob();
          blob.setName(fileName || asset.name);
          
          // Create a folder for Monday.com downloads if it doesn't exist
          let folder;
          const folders = DriveApp.getFoldersByName('Monday.com Downloads');
          if (folders.hasNext()) {
            folder = folders.next();
          } else {
            folder = DriveApp.createFolder('Monday.com Downloads');
            console.log('Created new folder: Monday.com Downloads');
          }
          
          // Save to Drive in the folder
          const file = folder.createFile(blob);
          console.log('File saved to Drive:', file.getName());
          console.log('Drive file URL:', file.getUrl());
          
          return {
            success: true,
            file: file,
            url: file.getUrl(),
            id: file.getId()
          };
        } else {
          console.log('Download failed with code:', responseCode);
          console.log('Response headers:', JSON.stringify(downloadResponse.getHeaders()));
        }
      } catch (e) {
        console.log('Download attempt failed:', e.toString());
      }
    }
    
    throw new Error('All download attempts failed');
  } catch (error) {
    console.error('Error in downloadMondayAsset:', error);
    return null;
  }
}

/**
 * Server function to download Monday.com file to Google Drive
 */
function downloadMondayFileToGoogleDrive(file) {
  try {
    console.log('=== DOWNLOAD TO GOOGLE DRIVE ===');
    console.log('File info:', JSON.stringify({
      name: file.name,
      id: file.id,
      fileType: file.fileType,
      hasUrl: !!file.url,
      hasPublicUrl: !!file.publicUrl
    }));
    
    // For ASSET type files, use the asset ID
    if (file.fileType === 'ASSET' && file.id) {
      console.log('Using asset ID to download:', file.id);
      const result = downloadMondayAsset(file.id, file.name);
      if (result) return result;
    }
    
    // For LINK type files (external links like Zoom), download directly
    if (file.fileType === 'LINK' && file.url) {
      console.log('Downloading external link directly...');
      try {
        const response = UrlFetchApp.fetch(file.url, {
          muteHttpExceptions: true,
          followRedirects: true
        });
        
        if (response.getResponseCode() === 200) {
          const blob = response.getBlob();
          blob.setName(file.name || 'download');
          
          // Create folder if needed
          let folder;
          const folders = DriveApp.getFoldersByName('Monday.com Downloads');
          if (folders.hasNext()) {
            folder = folders.next();
          } else {
            folder = DriveApp.createFolder('Monday.com Downloads');
          }
          
          const driveFile = folder.createFile(blob);
          
          return {
            success: true,
            file: driveFile,
            url: driveFile.getUrl(),
            id: driveFile.getId()
          };
        }
      } catch (e) {
        console.log('Direct download failed:', e);
      }
    }
    
    // For PUBLIC type (direct URLs without asset ID)
    if (file.fileType === 'PUBLIC' && file.url) {
      console.log('Attempting direct download for PUBLIC type...');
      try {
        const response = UrlFetchApp.fetch(file.url, {
          muteHttpExceptions: true,
          followRedirects: true
        });
        
        if (response.getResponseCode() === 200) {
          const blob = response.getBlob();
          blob.setName(file.name || 'download');
          
          // Create folder if needed
          let folder;
          const folders = DriveApp.getFoldersByName('Monday.com Downloads');
          if (folders.hasNext()) {
            folder = folders.next();
          } else {
            folder = DriveApp.createFolder('Monday.com Downloads');
          }
          
          const driveFile = folder.createFile(blob);
          
          return {
            success: true,
            file: driveFile,
            url: driveFile.getUrl(),
            id: driveFile.getId()
          };
        }
      } catch (e) {
        console.log('Public URL download failed:', e);
      }
    }
    
    // If all attempts failed
    console.error('Download failed - no valid method found');
    return { 
      success: false, 
      error: 'Failed to download file. The file may require manual download from Monday.com.' 
    };
    
  } catch (error) {
    console.error('Error in downloadMondayFileToGoogleDrive:', error);
    return { success: false, error: error.toString() };
  }
}
