// --- JavaScript (script.js - Hoàn thiện v3) ---

// --- Configuration ---
// !!! QUAN TRỌNG: Thay thế bằng URL Web App thực tế của bạn sau khi triển khai Apps Script !!!
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwd2dmoqXdXcnZCCNjJLEN6YskOPWDdQYfeRfZDAb1HI5T0liAQ-qnpXkU6iP7HNnA0Aw/exec';

// --- Global State ---
let athletes = []; // Holds all athlete data fetched from server
let filteredAthletes = []; // Holds currently displayed athletes
let selectedAthleteIds = new Set(); // Holds IDs of selected athletes for batch check-in
let currentModalAthlete = null; // Athlete being processed in the check-in modal
let cameraStream = null; // Holds the camera stream for cleanup
let isFetching = false; // Flag to prevent concurrent data fetches
let isCommitting = false; // Flag to prevent concurrent GitHub commits

// QR Scanner state
let qrScanner = null; // Holds the video element during scan
let qrAnimation = null; // Holds the requestAnimationFrame ID for QR scanning

// --- DOM Elements ---
const loader = document.getElementById('loader');
const athletesListContainer = document.getElementById('athletes-list');
const resultsCountSpan = document.getElementById('results-count');
const searchInput = document.getElementById('search-input');
const refreshBtn = document.getElementById('refresh-btn');
const distanceFilterGroup = document.getElementById('distance-filter');
const genderFilterGroup = document.getElementById('gender-filter');
const qrScanBtn = document.getElementById('qr-scan-btn');
const exportBtn = document.getElementById('export-btn');
const commitBtn = document.getElementById('commit-btn');
const checkinSelectedBtn = document.getElementById('checkin-selected-btn');
const noResultsMessage = document.getElementById('no-results');
const notificationArea = document.getElementById('notification-area');

// Photo Modal Elements
const photoModal = document.getElementById('photo-modal');
const modalCloseBtn = photoModal.querySelector('.close-btn');
const modalCancelBtn = photoModal.querySelector('#cancel-modal-btn');
const modalVideo = photoModal.querySelector('#camera-video');
const modalCanvas = photoModal.querySelector('#canvas');
const modalCaptureBtn = photoModal.querySelector('#capture-btn');
const modalRetakeBtn = photoModal.querySelector('#retake-btn');
const modalConfirmBtn = photoModal.querySelector('#confirm-btn');
const modalAthleteInfo = photoModal.querySelector('#modal-athlete-info');
const modalCameraError = photoModal.querySelector('#camera-error');


// --- Utility Functions ---

/**
 * Debounce function to limit the rate at which a function can fire.
 */
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

/** Shows the loading indicator. */
function showLoader() {
    if (loader) loader.style.display = 'block';
    if (athletesListContainer) athletesListContainer.style.display = 'none';
    if (noResultsMessage) noResultsMessage.style.display = 'none';
}

/** Hides the loading indicator. */
function hideLoader() {
    if (loader) loader.style.display = 'none';
    // Don't force display grid here, renderAthletes will handle it
}

/** Formats a Date object into "DD/MM/YYYY HH:MM". */
function formatDate(date) {
    if (!date || !(date instanceof Date)) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/** Shows a notification message. */
function showNotification(message, type = 'info', duration = 4000) {
    if (!notificationArea) return;
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.animationDuration = '0.5s, 0.5s'; // In, Out
    notification.style.animationDelay = `0s, ${duration / 1000 - 0.5}s`; // Delay fadeOut
    notificationArea.appendChild(notification);
    setTimeout(() => { notification.remove(); }, duration);
}

// --- Data Fetching and Processing ---

/**
 * Fetches athlete data from the Google Apps Script Web App (doGet).
 */
async function fetchAthletes() {
    if (isFetching) {
        console.log("Fetch already in progress. Skipping.");
        showNotification("Đang tải dữ liệu...", "info", 1500);
        return;
    }
    isFetching = true;
    showLoader();
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải...';
    console.log('Fetching athletes via Web App URL...');

    try {
        if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://script.google.com/macros/s/')) {
             throw new Error("WebApp URL không hợp lệ. Vui lòng kiểm tra cấu hình `script.js`.");
        }
        const response = await fetch(WEBAPP_URL); // Call Apps Script doGet
        console.log(`Fetch response status: ${response.status}`);

        const responseText = await response.text(); // Read response text first

        if (!response.ok) {
            let errorMsg = `Lỗi ${response.status} khi tải dữ liệu từ server.`;
            try {
                 const errData = JSON.parse(responseText); // Try parsing error JSON
                 errorMsg = `Lỗi server: ${errData.error || responseText || response.statusText}`;
            } catch(e){
                errorMsg = `Lỗi ${response.status}: ${responseText || response.statusText}`; // Use text if JSON parse fails
             }
            throw new Error(errorMsg);
        }

        // If response is OK, parse JSON
        let jsonData;
        try {
             jsonData = JSON.parse(responseText);
        } catch (e) {
             console.error("Failed to parse response JSON:", e);
             console.error("Raw Response Text:", responseText); // Log raw text for debugging
             throw new Error(`Dữ liệu trả về từ server không phải JSON hợp lệ.`);
        }

        // Check for logical errors returned in JSON
        if (jsonData.success === false && jsonData.error) {
            throw new Error(jsonData.error);
        }

        processDataFromWebApp(jsonData); // Process the valid JSON data

        console.log(`Fetched ${athletes.length} athletes successfully.`);
        // Only show success if data is actually loaded
        if (athletes.length > 0) {
             showNotification('Danh sách VĐV đã được cập nhật.', 'success', 2000);
        } else {
            console.log("Fetched data but the list is empty.");
            showNotification('Danh sách VĐV trống hoặc không có dữ liệu hợp lệ.', 'info', 3000);
        }

    } catch (error) {
        console.error('Error fetching data:', error);
        showNotification(`Lỗi khi tải dữ liệu: ${error.message}. Vui lòng thử lại.`, 'error', 6000);
        athletes = []; // Clear data on error
        filteredAthletes = [];
        renderAthletes(); // Update UI to show empty state
    } finally {
        applyFilters(); // Apply filters (or show no results)
        hideLoader();
        isFetching = false;
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Làm mới';
    }
}

/**
 * Processes data received from the Apps Script Web App (doGet).
 * Expects an array of objects with lowercase keys.
 */
function processDataFromWebApp(jsonData) {
    if (!Array.isArray(jsonData)) {
        console.error("Invalid data format received (expected array):", jsonData);
        throw new Error("Dữ liệu nhận được từ server không hợp lệ.");
    }
    athletes = jsonData.map((item, index) => {
        // Basic validation and normalization
        const id = String(item.id || '').trim();
        const name = String(item.name || 'N/A').trim();
        const bib = String(item.bib || 'N/A').trim();

        // Skip record if essential fields are missing
        if (!id || name === 'N/A' || bib === 'N/A') {
            console.warn(`Skipping invalid record at index ${index}:`, item);
            return null; // Will be filtered out later
        }

        return {
            id: id,
            name: name,
            gender: String(item.gender || '').trim(),
            distance: String(item.distance || '').trim().toUpperCase(),
            bib: bib,
            checkedIn: item.checkedin === true, // Ensure boolean
            checkinTime: String(item.checkintime || '').trim(),
            photoUrl: String(item.photourl || '').trim() // Drive URL or empty
        };
    }).filter(athlete => athlete !== null); // Remove null entries from invalid records
}

// --- UI Rendering and Filtering ---

/** Renders the list of athletes based on `filteredAthletes`. */
function renderAthletes() {
    if (!athletesListContainer) return;
    athletesListContainer.innerHTML = ''; // Clear previous list

    if (filteredAthletes.length === 0) {
        noResultsMessage.style.display = 'block';
        athletesListContainer.style.display = 'none';
    } else {
        noResultsMessage.style.display = 'none';
        athletesListContainer.style.display = 'grid';
        const fragment = document.createDocumentFragment();
        filteredAthletes.forEach(athlete => {
            const card = document.createElement('div');
            card.className = `athlete-card ${athlete.checkedIn ? 'checked-in' : ''} ${selectedAthleteIds.has(athlete.id) ? 'selected' : ''}`;
            card.dataset.id = athlete.id;
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Vận động viên ${athlete.name}, BIB ${athlete.bib}`);
            card.setAttribute('aria-pressed', selectedAthleteIds.has(athlete.id) ? 'true' : 'false');

            const photoUrl = athlete.photoUrl || 'https://via.placeholder.com/80/EEEEEE/999999?text=No+Image'; // Placeholder with grey background
            const checkinStatusText = athlete.checkedIn ? 'Đã check-in' : 'Chưa check-in';
            const checkinStatusClass = athlete.checkedIn ? 'checked' : 'not-checked';

            card.innerHTML = `
                <div class="athlete-photo">
                    <img src="${photoUrl}" alt="Ảnh VĐV ${athlete.name}" loading="lazy" onerror="this.onerror=null; this.src='https://via.placeholder.com/80/FFCCCC/CC0000?text=Error'; this.alt='Lỗi tải ảnh';">
                </div>
                <div class="athlete-info">
                    <div class="athlete-name">${athlete.name}</div>
                    <div class="athlete-details">
                        <span class="athlete-bib">BIB: ${athlete.bib}</span> |
                        <span>${athlete.distance || 'N/A'}</span> |
                        <span>${athlete.gender || 'N/A'}</span>
                    </div>
                    <div class="checkin-status ${checkinStatusClass}">${checkinStatusText}</div>
                    ${athlete.checkinTime ? `<div class="checkin-time">Lúc: ${athlete.checkinTime}</div>` : ''}
                </div>
            `;
            // Double-click listener for quick check-in
            card.addEventListener('dblclick', () => {
                 if (!athlete.checkedIn) {
                     console.log(`Double-clicked to check-in ${athlete.id}`);
                     checkInAthlete(athlete.id);
                 } else {
                     showNotification(`${athlete.name} đã check-in rồi.`, 'info');
                 }
             });
            fragment.appendChild(card);
        });
        athletesListContainer.appendChild(fragment);
    }
    updateResultsCount(); // Update count and button states
}

/** Updates the results count display and check-in button state. */
function updateResultsCount() {
    if (resultsCountSpan) {
        resultsCountSpan.textContent = `[${filteredAthletes.length}/${athletes.length}]`;
    }
    // Toggle checkin selected button based on selection
    const hasSelection = selectedAthleteIds.size > 0;
    checkinSelectedBtn.disabled = !hasSelection;
    checkinSelectedBtn.title = hasSelection
        ? `Check-in ${selectedAthleteIds.size} VĐV đã chọn`
        : "Chọn ít nhất một VĐV để check-in";
}

/** Applies current filters (search, distance, gender) to the athletes list. */
function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const selectedDistance = distanceFilterGroup.querySelector('.active')?.dataset.filter || 'all';
    const selectedGender = genderFilterGroup.querySelector('.active')?.dataset.gender || 'all';

    filteredAthletes = athletes.filter(athlete => {
        const nameMatch = athlete.name.toLowerCase().includes(searchTerm);
        const bibMatch = athlete.bib.toLowerCase().includes(searchTerm);
        const distanceMatch = selectedDistance === 'all' || athlete.distance === selectedDistance;
        const genderMatch = selectedGender === 'all' || (athlete.gender && athlete.gender.toLowerCase() === selectedGender.toLowerCase());

        return (nameMatch || bibMatch) && distanceMatch && genderMatch;
    });

    renderAthletes(); // Re-render the list with filtered results
}

/** Debounced version of applyFilters for search input */
const debouncedApplyFilters = debounce(applyFilters, 300);

// --- Check-in Logic ---

/** Initiates the check-in process for a single athlete by showing the photo modal. */
function checkInAthlete(athleteId) {
    const athlete = athletes.find(a => a.id === athleteId);
    if (!athlete) {
        showNotification(`Không tìm thấy VĐV với ID: ${athleteId}`, 'error');
        return;
    }
    if (athlete.checkedIn) {
        showNotification(`${athlete.name} (BIB: ${athlete.bib}) đã check-in rồi.`, 'info');
        return;
    }

    currentModalAthlete = athlete;
    deselectAllAthletes(); // Clear selection when checking in a single athlete
    showPhotoModal(); // Open the camera modal
}

/** Initiates check-in for all currently selected athletes (starts with the first). */
function checkInSelectedAthletes() {
    if (selectedAthleteIds.size === 0) {
        showNotification('Vui lòng chọn ít nhất một VĐV để check-in.', 'info');
        return;
    }

    const athletesToCheckIn = Array.from(selectedAthleteIds)
                                   .map(id => athletes.find(a => a.id === id))
                                   .filter(a => a && !a.checkedIn); // Only not-yet-checked-in ones

    if (athletesToCheckIn.length === 0) {
        showNotification('Tất cả VĐV đã chọn đều đã check-in.', 'info');
        deselectAllAthletes(); // Clear selection as action is complete
        return;
    }

    // Start the process with the first selected athlete in the modal
    console.log(`Starting batch check-in. Processing ${athletesToCheckIn[0].id} first.`);
    checkInAthlete(athletesToCheckIn[0].id);
    // The modal flow (confirmCheckIn) will handle processing the next selected athlete
}


// --- Photo Modal Logic ---

/** Shows the photo capture modal and starts the camera. */
async function showPhotoModal() {
    if (!currentModalAthlete) return;

    // Reset modal state thoroughly
    modalVideo.style.display = 'block';
    modalCanvas.style.display = 'none';
    modalCaptureBtn.style.display = 'inline-block';
    modalRetakeBtn.style.display = 'none';
    modalConfirmBtn.style.display = 'none';
    modalCameraError.style.display = 'none';
    modalAthleteInfo.textContent = `VĐV: ${currentModalAthlete.name} (BIB: ${currentModalAthlete.bib})`;
    modalConfirmBtn.disabled = false;
    modalConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Xác nhận Check-in';
    modalVideo.srcObject = null; // Clear previous stream

    photoModal.setAttribute('aria-hidden', 'false');
    photoModal.classList.add('active'); // Use class for visibility/animation

    try {
        console.log("Requesting camera stream (front)...");
        const constraints = { video: { facingMode: 'user' } };
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Trình duyệt không hỗ trợ truy cập camera (getUserMedia).");
        }
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Camera stream obtained.");
        modalVideo.srcObject = cameraStream;

        await new Promise((resolve, reject) => {
            modalVideo.onloadedmetadata = () => {
                modalVideo.play().then(resolve).catch(reject);
            };
            modalVideo.onerror = (e) => reject(new Error("Lỗi tải video từ camera."));
            setTimeout(() => reject(new Error("Hết thời gian chờ camera.")), 7000);
        });
        console.log("Video playing.");

    } catch (error) {
        console.error('Error accessing or playing camera:', error);
        modalCameraError.textContent = `Lỗi camera: ${error.name} - ${error.message}. Vui lòng cấp quyền và kiểm tra thiết bị.`;
        modalCameraError.style.display = 'block';
        modalCaptureBtn.style.display = 'none';
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
    }
}

/** Hides the photo capture modal and cleans up camera resources. */
function hidePhotoModal() {
    console.log("Hiding photo modal and cleaning up camera stream.");
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    if (modalVideo) {
        modalVideo.srcObject = null;
        modalVideo.pause();
        modalVideo.removeAttribute('src');
    }
    photoModal.setAttribute('aria-hidden', 'true');
    photoModal.classList.remove('active'); // Hide modal
    currentModalAthlete = null; // Clear the athlete being processed

    // Explicitly reset styles/states for safety
    if (modalVideo) modalVideo.style.display = 'block';
    if (modalCanvas) modalCanvas.style.display = 'none';
    if (modalCaptureBtn) modalCaptureBtn.style.display = 'inline-block';
    if (modalRetakeBtn) modalRetakeBtn.style.display = 'none';
    if (modalConfirmBtn) modalConfirmBtn.style.display = 'none';
    if (modalCameraError) modalCameraError.style.display = 'none';
    if (modalConfirmBtn) {
         modalConfirmBtn.disabled = false;
         modalConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Xác nhận Check-in';
    }
}

/** Captures a photo from the video stream onto the canvas. */
function capturePhoto() {
    console.log("Attempting to capture photo...");
    if (!cameraStream || !modalVideo || modalVideo.readyState < modalVideo.HAVE_METADATA || !modalVideo.videoWidth || !modalVideo.videoHeight) {
        showNotification("Camera chưa sẵn sàng hoặc video chưa tải.", "error");
        console.error("Capture failed: Video not ready.", { readyState: modalVideo?.readyState, w: modalVideo?.videoWidth, h: modalVideo?.videoHeight });
        return;
    }

    try {
        const context = modalCanvas.getContext('2d');
        // Set canvas dimensions to match video to avoid distortion
        modalCanvas.width = modalVideo.videoWidth;
        modalCanvas.height = modalVideo.videoHeight;
        console.log(`Canvas dimensions set to: ${modalCanvas.width}x${modalCanvas.height}`);

        context.drawImage(modalVideo, 0, 0, modalCanvas.width, modalCanvas.height);
        console.log("drawImage called.");

        // Update UI: Show canvas, hide video, change buttons
        modalVideo.style.display = 'none';
        modalCanvas.style.display = 'block';
        modalCaptureBtn.style.display = 'none';
        modalRetakeBtn.style.display = 'inline-block';
        modalConfirmBtn.style.display = 'inline-block';
        console.log("Display and buttons updated for captured photo.");
        // Optional: Pause video after capture to save resources
        // modalVideo.pause();

    } catch (error) {
         console.error("Error during photo capture:", error);
         showNotification("Lỗi khi chụp ảnh. Vui lòng thử lại.", "error");
         retakePhoto(); // Go back to camera view on error
    }
}

/** Switches back to the live camera view from the captured photo. */
function retakePhoto() {
    console.log("Retaking photo...");
    if (!modalVideo || !modalCanvas) return;

    modalVideo.style.display = 'block'; // Show video
    modalCanvas.style.display = 'none';  // Hide canvas
    // Optional: Ensure video plays if it was paused
    // if (modalVideo.paused) {
    //     modalVideo.play().catch(e => console.error("Error resuming video:", e));
    // }

    // Reset button visibility
    modalCaptureBtn.style.display = 'inline-block';
    modalRetakeBtn.style.display = 'none';
    modalConfirmBtn.style.display = 'none';
    console.log("Retake successful: Display and buttons reset.");
}

/**
 * Confirms check-in: Sends data (including photo) to Apps Script (action: 'checkin')
 * and updates local state based on the server response. Handles queue for selected athletes.
 */
async function confirmCheckIn() {
    if (!currentModalAthlete || !modalCanvas || modalCanvas.style.display === 'none') {
        console.error("ConfirmCheckIn called in invalid state.");
        showNotification("Chưa chụp ảnh hoặc VĐV không hợp lệ.", "error");
        return;
    }

    modalConfirmBtn.disabled = true;
    modalConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...';
    console.log(`Confirming check-in for athlete ID: ${currentModalAthlete.id}`);

    let photoDataUrl = '';
    try {
        // Get image data as JPEG (smaller size)
        photoDataUrl = modalCanvas.toDataURL('image/jpeg', 0.85); // Quality 85%
        // Basic check for valid base64 data length
        if (!photoDataUrl || photoDataUrl.length < 150) { // Check min length
             throw new Error("Ảnh chụp không hợp lệ hoặc quá nhỏ.");
        }
        console.log(`Generated photo Data URL (length: ${photoDataUrl.length})`);
    } catch (error) {
        console.error('Error getting photo data from canvas:', error);
        showNotification(`Lỗi xử lý ảnh chụp: ${error.message}`, 'error');
        modalConfirmBtn.disabled = false;
        modalConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Xác nhận Check-in';
        return; // Stop the process
    }

    // --- Attempt to update Google Sheet via Apps Script ---
    try {
        // Call the function that sends 'checkin' action to doPost
        const updateResult = await updateGoogleSheetCheckin(currentModalAthlete.id, photoDataUrl);

        if (updateResult && updateResult.success) {
            // Update local data based on successful server response
            const athleteIndex = athletes.findIndex(a => a.id === currentModalAthlete.id);
            if (athleteIndex > -1) {
                athletes[athleteIndex].checkedIn = true;
                // Use current client time for immediate UI update, server time is in sheet
                athletes[athleteIndex].checkinTime = formatDate(new Date());
                // Use the ACTUAL photo URL returned by the server (from Drive)
                athletes[athleteIndex].photoUrl = updateResult.actualPhotoUrl || '';
                console.log(`Local athlete ${currentModalAthlete.id} updated. Photo URL: ${athletes[athleteIndex].photoUrl}`);
            } else {
                 console.warn(`Athlete ID ${currentModalAthlete.id} not found locally after successful check-in.`);
            }

            showNotification(`VĐV ${currentModalAthlete.name} (BIB: ${currentModalAthlete.bib}) đã check-in!`, 'success');

            // Important: Deselect the athlete *after* successful processing
            deselectAthlete(currentModalAthlete.id); // Remove from selection set
            applyFilters(); // Re-render the list to show updated status and remove selection highlight

            // --- Handle Queue for Batch Check-in ---
            const remainingSelected = Array.from(selectedAthleteIds)
                                          .map(id => athletes.find(a => a.id === id)) // Get athlete objects
                                          .filter(a => a && !a.checkedIn); // Filter for remaining, not checked-in

            if (remainingSelected.length > 0) {
                 const nextAthlete = remainingSelected[0];
                 console.log(`Batch Check-in: Processing next selected athlete: ${nextAthlete.id}`);
                 // Hide current modal cleanly, then open for the next one after a short delay
                 hidePhotoModal();
                 setTimeout(() => checkInAthlete(nextAthlete.id), 150); // Small delay for transition
            } else {
                 console.log("Batch Check-in: No more selected athletes to process.");
                 hidePhotoModal(); // Close modal if the queue is empty
            }
            // --- End Queue Handling ---

        } else {
            // Error occurred, notification shown by updateGoogleSheetCheckin
            console.log("Check-in via Apps Script failed or returned error.");
            modalConfirmBtn.disabled = false; // Allow user to retry
            modalConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Xác nhận Check-in';
            // Do not automatically close the modal on failure, let user decide
        }
    } catch (error) { // Catch unexpected errors during the confirm flow
        console.error('Unexpected error during check-in confirmation flow:', error);
        showNotification('Có lỗi không mong muốn khi xác nhận check-in.', 'error');
        modalConfirmBtn.disabled = false;
        modalConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Xác nhận Check-in';
    }
}

/**
 * Sends a Check-in request to the Apps Script Web App (doPost, action: 'checkin').
 * Returns Promise<{success: boolean, actualPhotoUrl?: string, error?: string}>
 * @param {string} id Athlete ID.
 * @param {string} photoDataUrl Base64 encoded image data URL.
 */
async function updateGoogleSheetCheckin(id, photoDataUrl) {
    const now = new Date();
    const timeString = formatDate(now);

    const postData = {
        action: 'checkin', // Specify the action for doPost
        id: id,
        time: timeString,
        photoUrl: photoDataUrl // Base64 image data
    };

    console.log(`Attempting POST Check-in to: ${WEBAPP_URL} for ID: ${id}.`);

    if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://script.google.com/macros/s/')) {
         showNotification('URL Web App không hợp lệ.', 'error');
         return { success: false, error: 'Invalid WEBAPP_URL configuration.' };
    }

    try {
        const response = await fetch(WEBAPP_URL, {
            method: 'POST',
            mode: 'cors', // Required for cross-origin requests
            cache: 'no-cache',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData),
            redirect: 'follow' // Handle potential redirects
        });

        let responseData = null;
        try {
            // Try parsing the JSON response
            responseData = await response.json();
            console.log('Received Check-in response:', responseData);
        } catch (e) {
            // Handle cases where response is not valid JSON
            console.error("Could not parse JSON response for check-in:", e);
            const textResponse = await response.text().catch(() => "Could not read response text.");
            const errorMsg = `Lỗi ${response.status}: Server trả về dữ liệu không hợp lệ. ${textResponse.substring(0,150)}`;
            showNotification(errorMsg, 'error');
            return { success: false, error: errorMsg, status: response.status };
        }

        // Check if response status is OK AND logical success from Apps Script
        if (!response.ok || responseData.success === false) {
            const errorMsg = responseData?.error || `Lỗi không xác định từ server (Status ${response.status})`;
            console.error('Check-in request failed:', errorMsg);
            showNotification(`Lỗi Check-in VĐV ${id}: ${errorMsg}`, 'error', 6000);
            return { success: false, error: errorMsg, status: response.status, athleteId: id };
        }

        // Check-in successful
        return {
            success: true,
            actualPhotoUrl: responseData.actualPhotoUrl || null // Pass back the actual Drive URL
         };

    } catch (error) { // Catch network errors or other fetch-related issues
        console.error('Network or other error during check-in POST:', error);
        const displayError = (error instanceof TypeError && error.message.includes('Failed to fetch'))
                           ? 'Lỗi kết nối mạng khi gửi yêu cầu check-in.'
                           : `Lỗi không xác định: ${error.message}`;
        showNotification(displayError, 'error');
        return { success: false, error: displayError };
    }
}


// --- QR Code Scanning ---

/** Starts the QR code scanning process. */
async function startQrScanning() {
    // Check if jsQR library is loaded (must be included in HTML)
    if (typeof jsQR === 'undefined') {
        showNotification('Thư viện quét QR (jsQR) chưa được tải.', 'error');
        console.error("jsQR library is not loaded. Make sure it's included in your HTML.");
        return;
    }

    if (qrScanner) {
        showNotification('Đang quét QR...', 'info'); // Prevent multiple scanners
        return;
    }

    // Create video element dynamically for scanning
    qrScanner = document.createElement('video');
    qrScanner.setAttribute('playsinline', ''); // Important for iOS Safari
    qrScanner.style.position = 'fixed';
    qrScanner.style.top = '0';
    qrScanner.style.left = '0';
    qrScanner.style.width = '100%';
    qrScanner.style.height = '100%';
    qrScanner.style.objectFit = 'cover'; // Cover the screen
    qrScanner.style.zIndex = '1500'; // Ensure it's on top
    document.body.appendChild(qrScanner);

    // Add a prominent close button
    const closeScanBtn = document.createElement('button');
    closeScanBtn.textContent = '✕ Đóng Quét QR';
    closeScanBtn.style.position = 'fixed';
    closeScanBtn.style.bottom = '30px'; // Position lower
    closeScanBtn.style.left = '50%';
    closeScanBtn.style.transform = 'translateX(-50%)';
    closeScanBtn.style.zIndex = '1501'; // Above video
    closeScanBtn.style.padding = '12px 25px'; // Make it larger
    closeScanBtn.style.fontSize = '16px';
    closeScanBtn.style.backgroundColor = 'rgba(220, 53, 69, 0.9)'; // Red, slightly transparent
    closeScanBtn.style.color = 'white';
    closeScanBtn.style.border = 'none';
    closeScanBtn.style.borderRadius = '8px';
    closeScanBtn.style.cursor = 'pointer';
    closeScanBtn.onclick = stopQrScanning;
    document.body.appendChild(closeScanBtn);
    qrScanner.closeButton = closeScanBtn; // Store reference for cleanup

    // Create canvas for processing frames (offscreen is fine)
    const qrCanvas = document.createElement('canvas');
    // Add { willReadFrequently: true } for potential performance boost
    const qrContext = qrCanvas.getContext('2d', { willReadFrequently: true });

    showNotification('Hướng camera vào mã QR...', 'info', 5000);

    try {
        console.log("Requesting camera stream (environment)...");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' } // Prefer back camera
        });
        qrScanner.srcObject = stream;
        await qrScanner.play(); // Wait for play to start

        // Wait for metadata to get video dimensions correctly
        await new Promise(resolve => {
             if (qrScanner.readyState >= qrScanner.HAVE_METADATA) {
                 resolve();
             } else {
                 qrScanner.onloadedmetadata = resolve;
             }
         });

        qrCanvas.width = qrScanner.videoWidth;
        qrCanvas.height = qrScanner.videoHeight;
        console.log(`QR Scanner dimensions set: ${qrCanvas.width}x${qrCanvas.height}`);

        // Start scanning frames
        function scanFrame() {
            // Check if scanner is still active and ready
            if (!qrScanner || !qrScanner.srcObject || qrScanner.paused || qrScanner.ended || !qrScanner.videoWidth) {
                 console.log("QR scan loop stopped: Scanner not active or ready.");
                 return; // Stop the loop if scanner is closed or video not ready
            }

             try {
                 // Adjust canvas size if video dimensions change (e.g., orientation change)
                 if(qrCanvas.width !== qrScanner.videoWidth || qrCanvas.height !== qrScanner.videoHeight) {
                    qrCanvas.width = qrScanner.videoWidth;
                    qrCanvas.height = qrScanner.videoHeight;
                    console.log(`QR Scanner dimensions updated: ${qrCanvas.width}x${qrCanvas.height}`);
                 }

                // Draw video frame to canvas
                qrContext.drawImage(qrScanner, 0, 0, qrCanvas.width, qrCanvas.height);
                // Get image data from canvas
                const imageData = qrContext.getImageData(0, 0, qrCanvas.width, qrCanvas.height);

                // Check if image data is valid before passing to jsQR
                if (!imageData || !imageData.data || imageData.data.length === 0) {
                     console.warn("QR Scan: Captured empty image data.");
                     qrAnimation = requestAnimationFrame(scanFrame); // Request next frame
                     return;
                }

                // Attempt to decode QR code
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                     inversionAttempts: "dontInvert", // Optimization for standard QR codes
                });

                // If a code is found
                if (code && code.data) {
                    console.log('QR Code detected:', code.data);
                    showNotification(`Đã quét mã: ${code.data}`, 'success', 2000);
                    stopQrScanning(); // Stop scanning process
                    processQrCode(code.data); // Process the scanned data
                } else {
                    // If no code found, continue scanning next frame
                    qrAnimation = requestAnimationFrame(scanFrame);
                }
             } catch (scanError) {
                 console.error("Error during QR frame scan:", scanError);
                 // Decide whether to stop or continue on error
                 // For robustness, let's continue scanning unless the scanner itself is dead
                 if (qrScanner && qrScanner.srcObject) {
                     qrAnimation = requestAnimationFrame(scanFrame);
                 } else {
                     stopQrScanning(); // Cleanup if the scanner is gone
                 }
             }
        }
        // Start the first frame scan
        qrAnimation = requestAnimationFrame(scanFrame);

    } catch (error) {
        console.error('Error accessing camera for QR scanning:', error);
        showNotification(`Lỗi camera QR: ${error.name}. Vui lòng cấp quyền và kiểm tra thiết bị.`, 'error');
        stopQrScanning(); // Clean up UI and resources if camera fails
    }
}

/** Stops the QR code scanning process and cleans up resources. */
function stopQrScanning() {
    console.log('Stopping QR Scanning...');
    if (qrAnimation) {
        cancelAnimationFrame(qrAnimation); // Stop the scan loop
        qrAnimation = null;
    }
    if (qrScanner) {
        // Stop camera tracks first
        if (qrScanner.srcObject) {
            qrScanner.srcObject.getTracks().forEach(track => track.stop());
            qrScanner.srcObject = null; // Release the source
            console.log('QR Camera tracks stopped.');
        }
        // Remove the close button if it exists
         if (qrScanner.closeButton) {
            qrScanner.closeButton.remove();
         }
        // Remove the video element from the DOM
        qrScanner.remove();
        qrScanner = null; // Clear the variable
        console.log('QR Scanner element removed.');
    } else {
         console.log('QR Scanner was already stopped/null.');
    }
}

/** Processes the data obtained from the QR code (usually BIB or ID). */
function processQrCode(qrData) {
    // Ensure qrData is a non-empty string
    qrData = String(qrData || '').trim();
    if (!qrData) {
        showNotification('Mã QR không hợp lệ hoặc trống.', 'error');
        return;
    }
    console.log(`Processing QR data: "${qrData}"`);

    // Normalize QR data for comparison
    const lowerQrData = qrData.toLowerCase();

    // Attempt to find athlete by BIB first (case-insensitive)
    let foundAthlete = athletes.find(a => a.bib && String(a.bib).toLowerCase() === lowerQrData);

    // If not found by BIB, try finding by ID (case-insensitive)
    if (!foundAthlete) {
        console.log(`QR Data "${qrData}" not found as BIB, trying as ID...`);
        foundAthlete = athletes.find(a => a.id && String(a.id).toLowerCase() === lowerQrData);
    }

    if (foundAthlete) {
        showNotification(`Tìm thấy VĐV: ${foundAthlete.name} (BIB: ${foundAthlete.bib})`, 'success');

        // --- Optional UX Enhancements ---
        // 1. Scroll to the athlete card in the list
        const card = athletesListContainer.querySelector(`.athlete-card[data-id="${foundAthlete.id}"]`);
        if(card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 2. Add a temporary highlight effect
            card.classList.add('highlight'); // Add a CSS class for highlighting
            setTimeout(() => {
                if (card) card.classList.remove('highlight'); // Remove highlight after a delay
            }, 2500); // Highlight for 2.5 seconds
        }
        // --- End Optional UX ---

        // Automatically start the check-in process for the found athlete
        checkInAthlete(foundAthlete.id);

    } else {
        // If no athlete found by either BIB or ID
        showNotification(`Không tìm thấy VĐV nào khớp với mã QR: ${qrData}`, 'error');
    }
}

// --- Data Export and GitHub Commit ---

/** Exports currently filtered checked-in athletes to a JSON file. */
function exportToJson() {
    const dataToExport = filteredAthletes
        .filter(a => a.checkedIn) // Only checked-in athletes in the current view
        .map(({ id, name, bib, distance, gender, checkinTime, photoUrl }) => ({
            id, name, bib, distance, gender, checkinTime,
            // Optionally exclude potentially large photoUrl if not needed in export
             photoUrl: photoUrl // Include Drive URL
        }));

    if (dataToExport.length === 0) {
        showNotification('Không có VĐV đã check-in nào trong bộ lọc hiện tại để xuất.', 'info');
        return;
    }

    const jsonString = JSON.stringify(dataToExport, null, 2); // Pretty print JSON
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `checked_in_athletes_${timestamp}.json`;
    document.body.appendChild(a); // Required for Firefox
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`Đã xuất ${dataToExport.length} VĐV ra file JSON.`, 'success');
}

/** Triggers the GitHub commit process securely via Apps Script doPost. */
async function commitToGitHub() {
    if (isCommitting) {
        showNotification("Đang đẩy dữ liệu lên GitHub...", "info", 2000);
        return; // Prevent concurrent commits
    }
    isCommitting = true;
    commitBtn.disabled = true;
    commitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đẩy...';
    console.log("Requesting GitHub commit via Apps Script...");

    // Prepare data to send to Apps Script
    const postData = {
        action: 'commit' // Tell Apps Script which action to perform
        // No need to send athlete data, Apps Script reads directly from the Sheet
    };

    if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://script.google.com/macros/s/')) {
         showNotification('URL Web App không hợp lệ.', 'error');
         isCommitting = false; // Reset flag
         commitBtn.disabled = false; // Re-enable button
         commitBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Đẩy lên GitHub';
         return;
    }

    try {
        // Send the commit request to Apps Script doPost
        const response = await fetch(WEBAPP_URL, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData),
            redirect: 'follow'
        });

        let responseData = null;
        try {
            // Attempt to parse the response from Apps Script
            responseData = await response.json();
            console.log('Received Commit response:', responseData);
        } catch (e) {
            // Handle cases where the response isn't valid JSON
            console.error("Could not parse JSON response for commit:", e);
            const textResponse = await response.text().catch(() => "Could not read response text.");
            const errorMsg = `Lỗi ${response.status}: Server trả về dữ liệu không hợp lệ khi commit. ${textResponse.substring(0,150)}`;
            showNotification(errorMsg, 'error');
            // Throw error to be caught by the outer catch block
            throw new Error(errorMsg);
        }

        // Check if the response status is OK AND if Apps Script reported success
        if (!response.ok || responseData.success === false) {
            const errorMsg = responseData?.error || `Lỗi không xác định từ server khi commit (Status ${response.status})`;
            console.error('Commit request failed:', errorMsg);
            showNotification(`Lỗi đẩy lên GitHub: ${errorMsg}`, 'error', 8000);
            // Throw error to be caught by the outer catch block
            throw new Error(errorMsg);
        }

        // If everything is successful
        showNotification(`Đẩy dữ liệu lên GitHub thành công! Commit: ${responseData.commitUrl || '(Kiểm tra GitHub)'}`, 'success', 7000);

    } catch (error) { // Catch errors from fetch or thrown logical errors
        console.error('Error during GitHub commit request process:', error);
        // Notification was likely shown already where the error was detected
        // Optionally show a generic error here if needed:
        // showNotification(`Lỗi khi thực hiện đẩy lên GitHub: ${error.message}`, 'error');
    } finally {
        // Always reset the committing flag and re-enable the button
        isCommitting = false;
        commitBtn.disabled = false;
        commitBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Đẩy lên GitHub';
    }
}

// --- Athlete Selection Logic ---

/** Toggles the selection state of an athlete card. */
function toggleAthleteSelection(athleteId) {
    const card = athletesListContainer.querySelector(`.athlete-card[data-id="${athleteId}"]`);
    if (!card) return;

    if (selectedAthleteIds.has(athleteId)) {
        selectedAthleteIds.delete(athleteId);
        card.classList.remove('selected');
        card.setAttribute('aria-pressed', 'false');
    } else {
        // Only allow selecting athletes who are not already checked in
        const athlete = athletes.find(a => a.id === athleteId);
        if (athlete && !athlete.checkedIn) {
             selectedAthleteIds.add(athleteId);
             card.classList.add('selected');
             card.setAttribute('aria-pressed', 'true');
        } else if (athlete && athlete.checkedIn) {
            showNotification(`${athlete.name} đã check-in rồi, không thể chọn.`, 'info');
        }
    }
    updateResultsCount(); // Update button states
}

/** Deselects a specific athlete (e.g., after successful check-in). */
function deselectAthlete(athleteId) {
     if (selectedAthleteIds.has(athleteId)) {
        selectedAthleteIds.delete(athleteId);
        const card = athletesListContainer.querySelector(`.athlete-card[data-id="${athleteId}"]`);
        if (card) {
            card.classList.remove('selected');
            card.setAttribute('aria-pressed', 'false');
        }
        updateResultsCount(); // Update button state
    }
}

/** Deselects all currently selected athletes. */
function deselectAllAthletes() {
    if (selectedAthleteIds.size === 0) return; // No need to do anything if empty
    selectedAthleteIds.forEach(id => {
         const card = athletesListContainer.querySelector(`.athlete-card[data-id="${id}"]`);
        if (card) {
            card.classList.remove('selected');
            card.setAttribute('aria-pressed', 'false');
        }
    });
    selectedAthleteIds.clear();
    updateResultsCount(); // Update button state
    console.log("All athletes deselected.");
}


// --- Event Listeners ---

/** Sets up all event listeners for the application. */
function setupEventListeners() {
    // Search Input with Debounce
    searchInput.addEventListener('input', debouncedApplyFilters);

    // Refresh Button
    refreshBtn.addEventListener('click', fetchAthletes);

    // Filter Buttons (Distance & Gender) - Using Event Delegation
    distanceFilterGroup.addEventListener('click', (e) => {
        if (e.target.matches('.filter-btn')) {
            // Remove active class from all buttons in this group
            distanceFilterGroup.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            });
            // Add active class to the clicked button
            e.target.classList.add('active');
            e.target.setAttribute('aria-pressed', 'true');
            applyFilters(); // Apply filters after selection change
        }
    });
    genderFilterGroup.addEventListener('click', (e) => {
        if (e.target.matches('.filter-btn')) {
            // Similar logic for gender filter buttons
            genderFilterGroup.querySelectorAll('.filter-btn').forEach(btn => {
                 btn.classList.remove('active');
                 btn.setAttribute('aria-pressed', 'false');
            });
            e.target.classList.add('active');
            e.target.setAttribute('aria-pressed', 'true');
            applyFilters();
        }
    });

    // Athlete List Container - Event Delegation for clicks and keyboard
    athletesListContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.athlete-card');
        if (!card) return; // Exit if click wasn't on or inside a card

        const athleteId = card.dataset.id;
        const athlete = athletes.find(a => a.id === athleteId);
        if (!athlete) return; // Exit if athlete data not found

        // Handle double-click vs single-click
        if (e.detail === 2) { // Simple double-click detection
             // Handled by the dblclick listener added in renderAthletes
        } else {
             // Single click: Toggle selection only if not checked in
            if (!athlete.checkedIn) {
                 toggleAthleteSelection(athleteId);
            } else {
                 showNotification(`${athlete.name} đã check-in rồi.`, 'info');
                 // Optionally deselect if already selected
                 if (selectedAthleteIds.has(athleteId)) {
                     deselectAthlete(athleteId);
                 }
            }
        }
    });
    athletesListContainer.addEventListener('keydown', (e) => {
         // Handle Enter or Space key press on a focused card
         const card = e.target.closest('.athlete-card');
         if (!card) return;
         if (e.key === 'Enter' || e.key === ' ') {
             e.preventDefault(); // Prevent default space scroll or enter submit
             const athleteId = card.dataset.id;
             const athlete = athletes.find(a => a.id === athleteId);
             if (athlete && !athlete.checkedIn) {
                 // Option 1: Toggle selection with Enter/Space
                 toggleAthleteSelection(athleteId);
                 // Option 2: Directly initiate check-in with Enter/Space?
                 // checkInAthlete(athleteId);
             } else if (athlete && athlete.checkedIn) {
                  showNotification(`${athlete.name} đã check-in rồi.`, 'info');
             }
         }
     });

     // Check-in Selected Button
     checkinSelectedBtn.addEventListener('click', checkInSelectedAthletes);

     // QR Scan Button - This should now work correctly
     qrScanBtn.addEventListener('click', startQrScanning);

     // Export Button
     exportBtn.addEventListener('click', exportToJson);

     // Commit Button
     commitBtn.addEventListener('click', commitToGitHub);

     // Photo Modal Buttons & Interactions
     modalCloseBtn.addEventListener('click', hidePhotoModal);
     modalCancelBtn.addEventListener('click', hidePhotoModal);
     modalCaptureBtn.addEventListener('click', capturePhoto);
     modalRetakeBtn.addEventListener('click', retakePhoto);
     modalConfirmBtn.addEventListener('click', confirmCheckIn);
     // Close modal if clicking on the background overlay
     photoModal.addEventListener('click', (e) => {
         if (e.target === photoModal) {
             hidePhotoModal();
         }
     });
     // Close modal with Escape key
     photoModal.addEventListener('keydown', (e) => {
         if (e.key === 'Escape') {
             hidePhotoModal();
         }
     });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded.');

    // Check for jsQR dependency
    if (typeof jsQR === 'undefined') {
         console.error("jsQR library not loaded! QR Scanning will not work.");
         showNotification("Lỗi: Thư viện quét QR không tải được.", "error", 10000);
         // Disable QR button if library is missing
         if(qrScanBtn) qrScanBtn.disabled = true;
    }

    // Validate WebApp URL basic format
    if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://script.google.com/macros/s/')) {
        showNotification("LỖI CẤU HÌNH: URL Web App không hợp lệ! Vui lòng kiểm tra file script.js.", "error", 15000);
        console.error("WEBAPP_URL is not configured correctly! Please paste the correct URL from Apps Script deployment.");
        // Disable server interaction buttons if URL is invalid
        if(refreshBtn) refreshBtn.disabled = true;
        if(checkinSelectedBtn) checkinSelectedBtn.disabled = true;
        if(commitBtn) commitBtn.disabled = true;
        if(qrScanBtn) qrScanBtn.disabled = true; // QR scan leads to check-in
        // Optionally hide the loader as fetching won't happen
        if (loader) loader.style.display = 'none';
        return; // Stop further initialization if URL is bad
    }

    // Setup event listeners if URL seems okay
    setupEventListeners();

    // Initial data load when the page loads
    fetchAthletes();
});

// --- END OF script.js ---
