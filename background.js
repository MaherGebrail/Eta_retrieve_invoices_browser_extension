chrome.action.onClicked.addListener(async (tab) => {
  // Check if tab and tab.url exist
  if (!tab || !tab.url) {
    console.log('Cannot access this page');
    return;
  }
  
  // Only work on invoicing.eta.gov.eg
  if (!tab.url.includes('invoicing.eta.gov.eg')) {
    console.log('Extension only works on invoicing.eta.gov.eg');
    return;
  }
  
  // Inject your script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (error) {
    console.error('Failed to inject script:', error);
  }
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadFiles") {
    request.files.forEach(file => {
      chrome.downloads.download({
        url: file,
        conflictAction: 'uniquify'
      });
    });
    sendResponse({status: "Downloads started"});
  }
});
