// Main download function
async function downloadCSV(startDate, endDate, searchQuery, downloadOverAll=true, downloadDetailed=true) {
    
    // Get access token from localStorage
    console.log(`downloadOverAllInvoice: ${downloadOverAll}, downloadDetailedInvoices: ${downloadDetailed}`);
    if (!downloadOverAll && !downloadDetailed) {
        changeBtnState(false, 'Select a download option', mouseOutColor='#ff9800', mouseOutColor='#4CAF50');
        setTimeout(() => {
            changeBtnState(true);
        }, 3000);
        return;
    }
    changeBtnState(false);
    let access_token;
    try {
        const userData = JSON.parse(localStorage.getItem('USER_DATA'));
        access_token = userData.access_token;
        if (!access_token) {
            throw new Error('Access token not found');
        }
    } catch (error) {
        alert('Unable to get access token. Please make sure you are logged in.');
        throw error;
    }

    console.log('Starting data fetch...');
    const allData = await fetchAllData(access_token, startDate, endDate, searchQuery);
    const filename_date = `${startDate.split('T')[0]}_to_${endDate.split('T')[0]}`;
    if (allData.length > 0){
        console.log('Converting to CSV...');
        const overAllInvoicesCSV = convertToCSV(allData);
        
        if (downloadOverAll){
            console.log('Downloading CSV...');
            await triggerDownload(overAllInvoicesCSV, `documents_${filename_date}.csv`);
        }
        
        if(downloadDetailed){
            const detailedInvoicesUrls = extractUrlsFromCSV(overAllInvoicesCSV);
            console.log(`Extracted ${detailedInvoicesUrls.length} URLs`);
            
            changeBtnState(false, 'Downloading Detailed Invoices ...');
            
            const allProcessedData = await fetchAndProcessMultipleDocuments(detailedInvoicesUrls);
            
            // Convert to CSV
            console.log('Converting to CSV...');
            const csv_detailed = convertToCSV(allProcessedData);
            
            // Download
            const filename = `detailed_invoices_${filename_date}.csv`;
            await triggerDownload(csv_detailed, filename);

        }
        
    } else {
        alert('No data to export');
    }

    setTimeout(() => {
            changeBtnState(enable_btn=true);
        }, 2000);
}



// Detailed invoices
// Function to process document object and prepare data for CSV
function processDocumentForCSV(fdoc) {
    const keys_needed_from_object = [
        'uuid', 'internalID', 'status', 'submissionUUID', 
        'dateTimeIssued', 'totalAmount', 'netAmount', 'totalSales', 'documentTypeNameSecondaryLang'
    ];
    
    const invoicesLinesdicts_key = [
        'itemPrimaryName', 'itemPrimaryDescription', 'itemSecondaryName', 
        'itemSecondaryDescription', 'salesTotalForeign', 'netTotalForeign', 
        'totalForeign', 'description', 'itemCode', 'itemType', 'quantity', 
        'internalCode', 'netTotal', 'total', 'itemsDiscount'
    ];
    
    const invoices_all = [];
    
    // Extract main invoice values
    const invoice_values = {};
    keys_needed_from_object.forEach(key => {
        invoice_values[key] = fdoc[key] || null;
    });
    
    invoice_values['receiver_name'] = fdoc['receiver']['name'];
    invoice_values['receiver_address_street'] = fdoc['receiver']['address']['street'];

    invoice_values['issuer_name'] = fdoc['issuer']['name'];
    invoice_values['issuer_address_street'] = fdoc['issuer']['address']['street'];
    invoice_values['issuer_id'] = fdoc['issuer']['id'];
    // Calculate total taxes
    if (fdoc.taxTotals && Array.isArray(fdoc.taxTotals)) {
        invoice_values['tax_totals'] = fdoc.taxTotals.reduce((sum, tax) => sum + (tax.amount || 0), 0);
        
        // Add individual tax types
        fdoc.taxTotals.forEach(tax => {
            invoice_values[`tax_${tax.taxType}`] = tax.amount || 0;
        });
    }
    
    // Process each invoice line
    if (fdoc.invoiceLines && Array.isArray(fdoc.invoiceLines)) {
        fdoc.invoiceLines.forEach(invoiceLine => {
            // Copy main invoice values
            const invoice_needed = { ...invoice_values };
            
            // Extract invoice line details
            const invoice_details = {};
            invoicesLinesdicts_key.forEach(key => {
                invoice_details[key] = invoiceLine[key] || null;
            });
            
            // Add unit value
            if (invoiceLine.unitValue) {
                invoice_details['uniteValue_amountEGP'] = invoiceLine.unitValue.amountEGP || null;
            }
            
            // Add discount details
            if (invoiceLine.discount) {
                invoice_details['discount_rate'] = invoiceLine.discount.rate || 0;
                invoice_details['discount_amount'] = invoiceLine.discount.amount || 0;
            }
            
            // Add line tax details
            if (invoiceLine.lineTaxableItems && Array.isArray(invoiceLine.lineTaxableItems)) {
                invoiceLine.lineTaxableItems.forEach(tax => {
                    invoice_details[`tax_${tax.taxType}_rate`] = tax.rate || 0;
                    invoice_details[`tax_${tax.taxType}_amount`] = tax.amount || 0;
                });
            }
            
            // Merge all details
            Object.assign(invoice_needed, invoice_details);
            invoices_all.push(invoice_needed);
        });
    }
    
    return invoices_all;
}


// Function to fetch and process multiple documents (async version)
async function fetchAndProcessMultipleDocuments(linksArray, gotArray=true) {
    if (gotArray){
        console.log(`Starting to fetch ${linksArray.length} documents...`);
    }
    let successCount = 0;
    let failCount = 0;
    const access_token = JSON.parse(localStorage.getItem('USER_DATA')).access_token;
    // Create an array of promises for all fetch operations
    const fetchPromises = linksArray.map(async (link, i) => {
        try {
            // Getting the real link
            
            // Regular expression to extract document ID and token
            const regex = /documents\/(.*?)\/share\/(.*)/;
            const matches = link.match(regex);
            
            if (!matches) {
                console.log('No match found.');
                return [];
            }
            
            const documentId = matches[1];
            const token = matches[2];
            const newUrl = `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/${documentId}/details?documentLinesLimit=100`;
            //console.log('newUrl:', newUrl);
            
            // Fetch the document
            const response = await fetch(newUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${access_token}`,
                    'Accept-Language': 'en',
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const json_received = await response.json();
            
            // Process the document
            const processedData = processDocumentForCSV(json_received);
            successCount++;
            if (gotArray){
                console.log(`✓ Document ${i + 1} processed: ${processedData.length} lines added`);
            }
            return processedData;
            
        } catch (error) {
            failCount++;
            console.error(`✗ Failed to fetch/process document ${i + 1}:`, error);
            return []; // Return empty array on error
        }
    });
    
    // Wait for all promises to complete
    const results = await Promise.all(fetchPromises);
    
    // Flatten the array of arrays into a single array
    const allProcessedData = results.flat();
    if(gotArray){
        console.log(`\nFetch complete: ${successCount} successful, ${failCount} failed`);
        console.log(`Total processed lines: ${allProcessedData.length}`);
    }
    return allProcessedData;
}


// Helper function to extract Url column from CSV
function extractUrlsFromCSV(csvContent) {
    const lines = csvContent.split('\n');
    
    if (lines.length === 0) {
        return [];
    }
    
    // Parse header row to find publicUrl column index
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const publicUrlIndex = headers.indexOf('publicUrl');
    
    if (publicUrlIndex === -1) {
        console.log('publicUrl column not found in CSV');
        return [];
    }
    
    // Extract publicUrl values from each row (skip header)
    const publicUrls = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue; // Skip empty lines
        
        const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
        if (values[publicUrlIndex] && values[publicUrlIndex] !== '') {
            publicUrls.push(values[publicUrlIndex]);
        }
    }
    
    return publicUrls;
}


// Function to find the target div
function findTargetDiv() {
    var toolBarDiv = document.querySelector('div[role="toolbar"]');
    let count_check = 0;
    while (!toolBarDiv && count_check < 3){
        console.log('Target div not found, will retry...')
        setTimeout(
            () => toolBarDiv = document.querySelector('div[role="toolbar"]')
        , 3000);
        count_check++;
    }
    return toolBarDiv;
}

// Function to Change btn behavior
function changeBtnState(enable_btn=false, btn_content='Downloading ...', mouseOutColor='#0078d4', mouseOverColor='#106ebe'){
    const button = document.getElementById('csv-download-btn');
    
    if (!button) {
        console.log('Button with id "csv-download-btn" not found');
        return;
    }
    
    // Hover effect
    button.style.backgroundColor = mouseOverColor;
    button.onmouseout = () => button.style.backgroundColor = mouseOutColor;
    
    if (enable_btn){
        button.textContent = 'Download as CSV';
        button.disabled = false;
    } else {
        button.textContent = btn_content;
        button.disabled = true;
    }
}

// Function to create and inject the download Div
function injectDownloadContainer() {
    // Check if button already exists
    if (document.getElementById('csv-download-container')) {
        return;
    }

    const targetDiv = findTargetDiv();
    if (!targetDiv) {
        return;
    }

    // Create a container div
    const dateAndDownloadBtn = document.createElement('div');
    dateAndDownloadBtn.id = 'csv-download-container';
    dateAndDownloadBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        margin-left: 10px;
        flex-wrap: wrap;
        min-width: fit-content;
        flex-shrink: 0;
    `;

    // Query input label
    const queryLabel = document.createElement('span');
    queryLabel.textContent = 'Query:';
    queryLabel.style.cssText = `
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    // Query input field
    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.id = 'csv-query-input';
    queryInput.placeholder = 'Enter query...';
    queryInput.style.cssText = `
        padding: 6px 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 14px;
        min-width: 200px;
        flex-shrink: 0;
    `;

    const startLabel = document.createElement('span');
    startLabel.textContent = 'Date From:';
    startLabel.style.cssText = `
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    // Create start date input
    const startDateInput = document.createElement('input');
    startDateInput.type = 'date';
    startDateInput.id = 'csv-start-date';
    startDateInput.value = new Date(Date.now() - 86400000).toISOString().split('T')[0]; // Yesterday
    startDateInput.style.cssText = `
        padding: 6px 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 14px;
        flex-shrink: 0;
    `;

    const endLabel = document.createElement('span');
    endLabel.textContent = 'Date To:';
    endLabel.style.cssText = `
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    // Create end date input
    const endDateInput = document.createElement('input');
    endDateInput.type = 'date';
    endDateInput.id = 'csv-end-date';
    endDateInput.value = new Date().toISOString().split('T')[0]; // Today
    endDateInput.style.cssText = `
        padding: 6px 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 14px;
        flex-shrink: 0;
    `;


       // Create checkbox container
    const queryAndDownloadOptionContainer = document.createElement('div');
    queryAndDownloadOptionContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        margin-left: 10px;
        flex-wrap: wrap;
        min-width: fit-content;
        flex-shrink: 0;
    `;

    // Create "Download Overall Invoices" checkbox
    const overallCheckboxWrapper = document.createElement('label');
    overallCheckboxWrapper.style.cssText = `
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        font-size: 14px;
        white-space: nowrap;
    `;

    const overAllCheckbox = document.createElement('input');
    overAllCheckbox.type = 'checkbox';
    overAllCheckbox.id = 'download-overall-invoices';
    overAllCheckbox.checked = true;
    overAllCheckbox.style.cssText = `
        cursor: pointer;
        width: 16px;
        height: 16px;
    `;

    const overallLabel = document.createElement('span');
    overallLabel.textContent = 'Download Overall Invoices';

    overallCheckboxWrapper.appendChild(overAllCheckbox);
    overallCheckboxWrapper.appendChild(overallLabel);

    // Create "Download Detailed Invoices" checkbox
    const detailedCheckboxWrapper = document.createElement('label');
    detailedCheckboxWrapper.style.cssText = `
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        font-size: 14px;
        white-space: nowrap;
    `;

    const detailedCheckbox = document.createElement('input');
    detailedCheckbox.type = 'checkbox';
    detailedCheckbox.id = 'download-detailed-invoices';
    detailedCheckbox.checked = true;
    detailedCheckbox.style.cssText = `
        cursor: pointer;
        width: 16px;
        height: 16px;
    `;

    const detailedLabel = document.createElement('span');
    detailedLabel.textContent = 'Download Detailed Invoices';

    detailedCheckboxWrapper.appendChild(detailedCheckbox);
    detailedCheckboxWrapper.appendChild(detailedLabel);

    queryAndDownloadOptionContainer.appendChild(overallCheckboxWrapper);
    queryAndDownloadOptionContainer.appendChild(detailedCheckboxWrapper);

    // Create the button
    const button = document.createElement('button');
    button.id = 'csv-download-btn';
    button.textContent = 'Download as CSV';
    button.style.cssText = `
        padding: 8px 16px;
        margin-left: 10px;
        background-color: #0078d4;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s;
        flex-shrink: 0;
        white-space: nowrap;
    `;

    
    // Click handler
    button.onclick = async () => {
    // Get query value
    const query = queryInput.value.trim();
    
    // Get dates from inputs
    const startDateValue = new Date(startDateInput.value);
    startDateValue.setDate(startDateValue.getDate() - 1);
    const startDate = startDateValue.toISOString().split('T')[0] + 'T22:00:00.000Z';
    const endDate = endDateInput.value + 'T21:59:59.999Z';
    const downloadDetailedInvoices = detailedCheckbox.checked;
    const downloadOverAllInvoices = overAllCheckbox.checked;
    
    try {
        await downloadCSV(startDate, endDate, query, 
            downloadOverAllInvoices,  
            downloadDetailedInvoices); 
    } catch (error) {
        console.error('Download failed:', error);
        button.textContent = 'Download Failed';
        button.style.backgroundColor = '#d13438';
        setTimeout(() => {
            button.style.backgroundColor = '#0078d4';
            changeBtnState(true);
        }, 3000);
    }
    };

    // Add all elements to container in order
    queryAndDownloadOptionContainer.appendChild(queryLabel);
    queryAndDownloadOptionContainer.appendChild(queryInput);

    dateAndDownloadBtn.appendChild(startLabel);
    dateAndDownloadBtn.appendChild(startDateInput);
    dateAndDownloadBtn.appendChild(endLabel);
    dateAndDownloadBtn.appendChild(endDateInput);
    dateAndDownloadBtn.appendChild(button);

    // Append container to the target div
    targetDiv.prepend(dateAndDownloadBtn);
    targetDiv.prepend(queryAndDownloadOptionContainer);
    changeBtnState(true);

    console.log('CSV download Div injected successfully');
}


// Function to flatten lineItems array into separate columns
async function retrieveNeededOfFullInvoice(data) {

  const result = {
    publicUrl: data.publicUrl,
    id: data.id,
    status: data.source.documentStatusAR,
    statusEn: data.source.documentStatusEN,
    internalId: data.source.internalId, 
    submissionDate: data.source.submissionDate,
    documentTypeNameEn: data.source.documentTypeNameEn, 
    documentTypeNameAr:  data.source.documentTypeNameAr,
    submitterId: data.source.submitterId, 
    submitterName: data.source.submitterName,
    recipientId: data.source.recipientId,
    recipientName: data.source.recipientName,
    totalInvoiceAmount: data.source.totalInvoiceAmount,
    totalSales: data.source.totalSales,
    netAmount: data.source.netAmount,
    taxTotals: (data.source.totalInvoiceAmount - data.source.netAmount).toFixed(2)

  };
       
    total_taxes = 0;
    if(data.source.taxTotals){
    data.source.taxTotals.forEach((tax, index) => {
          Object.keys(tax).forEach((taxKey) => {
            result[`taxTotals_${index}_${taxKey}`] = tax[taxKey];
            if(taxKey =='amount'){
                total_taxes += tax[taxKey];
            }
          });
      })
    }

    if (total_taxes == 0){
        got_data = await fetchAndProcessMultipleDocuments([result.publicUrl], false);
        got_data = got_data[0];
        if('tax_T1' in got_data){
        result[`taxTotals_0_type`] = 'T1';     
        result[`taxTotals_0_amount`] = got_data.tax_T1;
        }
        if ('tax_T2' in got_data){
        result[`taxTotals_1_type`] = 'T2';
        result[`taxTotals_1_amount`] = got_data.tax_T2 || null;
        }
    }
    return result;
}


// Function to make a GET request for a specific page
async function fetchPage(pageNumber, access_token, startDate, endDate, searchQuery) {
    searchQuery = searchQuery.trim()
    if(searchQuery.length > 0){
        url_fetch_documents = `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/search?Query=${searchQuery}&IssueDateFrom=${startDate}&IssueDateTo=${endDate}&Page=${pageNumber}&PageSize=100`;
        }else{
        url_fetch_documents = `https://api-portal.invoicing.eta.gov.eg/api/v1/documents/search?IssueDateFrom=${startDate}&IssueDateTo=${endDate}&Page=${pageNumber}&PageSize=100`;
        }

    // console.log(`Fetching page ${pageNumber}...`);

    const response = await fetch(url_fetch_documents, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json'
        }
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error! Status: ${response.status}`, errorText);
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const rawText = await response.text();
    const data = JSON.parse(rawText);
    return data;
}

async function fetchAllData(access_token, startDate, endDate, searchQuery) {
    console.log('Fetching first page to get total pages...');

    const firstPage = await fetchPage(1, access_token, startDate, endDate, searchQuery);
    if (!firstPage) {
        throw new Error('Failed to fetch first page');
    }

    console.log('First page data structure:', firstPage);

    const totalPages = firstPage.metadata.totalPages;
    console.log(`Total pages: ${totalPages}`);

    let allSources = [];

    // Add sources from first page
    if (firstPage.result && Array.isArray(firstPage.result)) {
        console.log(`First page has ${firstPage.result.length} results`);
        firstPage.result.forEach(async(item) => {
        if (item) {
            // Flatten the lineItems
            allSources.push(await retrieveNeededOfFullInvoice(item));
        }
        });
    }

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
        console.log(`Fetching page ${page} of ${totalPages}...`);
        const pageData = await fetchPage(page, access_token, startDate, endDate, searchQuery);

        if (pageData && pageData.result && Array.isArray(pageData.result)) {
            pageData.result.forEach(async(item) => {
                if (item.source) {
                    allSources.push(await retrieveNeededOfFullInvoice(item));
                }
            });
        }

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Total records retrieved: ${allSources.length}`);
    return allSources;
}

// Function to convert array of objects to CSV
function convertToCSV(data) {
    if (data.length === 0) {
        return '';
    }

    const allKeys = new Set();
    data.forEach(obj => {
        Object.keys(obj).forEach(key => allKeys.add(key));
    });

    const headers = Array.from(allKeys);
    const csvHeader = headers.map(h => `"${h}"`).join(',');

    const csvRows = data.map(obj => {
        return headers.map(header => {
            const value = obj[header];
            if (value === null || value === undefined) {
                return '""';
            }
            if (typeof value === 'object') {
                return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
            }
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',');
    });

    return [csvHeader, ...csvRows].join('\n');
}


// Function to trigger download
async function triggerDownload(csvContent, filename) {

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    // return csvContent;
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log(`CSV file "${filename}" downloaded successfully!`);

    
}


injectDownloadContainer();

