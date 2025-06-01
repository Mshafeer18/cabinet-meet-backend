// index.js

// 1) Load environment variables
require('dotenv').config();

// 2) Import core modules
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const PDFDocument = require('pdfkit');

// 3) Ensure "uploads/" folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 4) Create Express app and middleware
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

// 5) Connect to MongoDB Atlas
const mongoURI = process.env.MONGO_URI;
mongoose
  .connect(mongoURI, {
    tls: true,
    // If you want to enforce TLS 1.2+, you could add:
    // minVersion: 'TLSv1.2',
  })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// 6) Define Mongoose schema & model
const registrationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cluster: { type: String, required: true },
  unit: { type: String, required: true },
  designations: [{ type: String }],
  photoUrl: { type: String }, // will store local path, e.g. "uploads/filename.jpg"
  createdAt: { type: Date, default: Date.now },
});
const Registration = mongoose.model('Registration', registrationSchema);

// 7) Configure Multer for photo uploads
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = file.fieldname + '-' + Date.now() + ext;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  // Optional: limit file size and ensure only images:
  // limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  // fileFilter: (req, file, cb) => {
  //   if (file.mimetype.startsWith('image/')) return cb(null, true);
  //   cb(new Error('Only image files are allowed'), false);
  // }
});

// 8) POST /api/register → create new registration
app.post('/api/register', upload.single('photo'), async (req, res) => {
  try {
    const { name, cluster, unit, designations } = req.body;
    if (!name || !cluster || !unit || !designations) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    let photoUrl = '';
    if (req.file) {
      // Multer has saved the file under "uploads/..."
      photoUrl = req.file.path; // e.g. 'uploads/photo-1629876543210.jpg'
    }

    let designationsArray = [];
    if (typeof designations === 'string') {
      designationsArray = designations.split(',').map((item) => item.trim());
    } else if (Array.isArray(designations)) {
      designationsArray = designations;
    }

    const newRegistration = new Registration({
      name,
      cluster,
      unit,
      designations: designationsArray,
      photoUrl,
    });
    const savedRegistration = await newRegistration.save();
    res.json({ message: 'Registration successful', data: savedRegistration });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

// 9) Admin CRUD endpoints
app.get('/api/registrations', async (req, res) => {
  try {
    const registrations = await Registration.find({}).lean();
    res.json(registrations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/registration/:id', async (req, res) => {
  try {
    const updated = await Registration.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ message: 'Registration updated', data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/registration/:id', async (req, res) => {
  try {
    const deleted = await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: 'Registration deleted', data: deleted });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// 10) PDF Export: Registrations table (A4)
app.get('/api/admin/export/registrations', async (req, res) => {
  try {
    const registrations = await Registration.find({}).lean();
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=registrations.pdf');
    doc.pipe(res);

    // -- Headings
    doc.fontSize(16).text('SKSSF Kadaba Zone', { align: 'center' });
    doc.fontSize(14).text('Annual Cabinet-Meet 2025', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text('Registration Data', { align: 'center' });
    doc.moveDown(0.5);

    // -- Table columns setup
    const colWidths = {
      sn: 30,
      photo: 50,
      name: 90,
      cluster: 60,
      unit: 60,
      designations: 120,
      signature: 60,
    };
    const totalTableWidth = Object.values(colWidths).reduce((sum, w) => sum + w, 0); // 470 pts
    const startX = (doc.page.width - totalTableWidth) / 2;
    let yPosition = doc.y;

    // Draw top border above header
    doc
      .moveTo(startX, yPosition)
      .lineTo(startX + totalTableWidth, yPosition)
      .strokeColor('#999')
      .lineWidth(0.5)
      .stroke();

    // Header row (20pt tall)
    const headerHeight = 20;
    let x = startX;
    doc.fontSize(10);
    ['S/N', 'Photo', 'Name', 'Cluster', 'Unit', 'Designations', 'Signature'].forEach((text, idx) => {
      const key = Object.keys(colWidths)[idx];
      doc.text(text, x, yPosition + 5, { width: colWidths[key], align: 'center' });
      x += colWidths[key];
    });
    const headerBottom = yPosition + headerHeight;

    // Draw bottom border under header
    doc
      .moveTo(startX, headerBottom)
      .lineTo(startX + totalTableWidth, headerBottom)
      .strokeColor('#999')
      .lineWidth(0.5)
      .stroke();

    // -- Data rows
    yPosition = headerBottom;
    const rowHeight = 60;
    let serialNo = 1;

    registrations.forEach((reg) => {
      x = startX;

      // S/N column
      doc.fontSize(10).text(serialNo.toString(), x, yPosition + 10, { width: colWidths.sn, align: 'center' });
      serialNo++;
      x += colWidths.sn;

      // Photo column
      if (reg.photoUrl) {
        try {
          const imagePath = path.join(__dirname, reg.photoUrl);
          doc.image(imagePath, x + 5, yPosition + 5, { fit: [colWidths.photo - 10, 50] });
        } catch (err) {
          console.error(`Error loading image for ${reg.name}:`, err);
          doc.fontSize(8).text('N/A', x, yPosition + 5, { width: colWidths.photo, align: 'center' });
        }
      } else {
        doc.fontSize(8).text('N/A', x, yPosition + 5, { width: colWidths.photo, align: 'center' });
      }
      x += colWidths.photo;

      // Name / Cluster / Unit / Designations / Signature
      doc.fontSize(10).text(reg.name, x, yPosition + 10, { width: colWidths.name, align: 'left' });
      x += colWidths.name;
      doc.text(reg.cluster, x, yPosition + 10, { width: colWidths.cluster, align: 'left' });
      x += colWidths.cluster;
      doc.text(reg.unit, x, yPosition + 10, { width: colWidths.unit, align: 'left' });
      x += colWidths.unit;
      doc.text(reg.designations.join(', '), x, yPosition + 10, {
        width: colWidths.designations,
        align: 'left',
      });
      x += colWidths.designations;
      doc.text('', x, yPosition + 10, { width: colWidths.signature, align: 'center' });

      // Bottom border under this row
      doc
        .moveTo(startX, yPosition + rowHeight)
        .lineTo(startX + totalTableWidth, yPosition + rowHeight)
        .strokeColor('#999')
        .lineWidth(0.5)
        .stroke();

      yPosition += rowHeight;

      // Page break logic
      if (yPosition > doc.page.height - 50) {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 50 });
        yPosition = doc.y;
        const newStartX = (doc.page.width - totalTableWidth) / 2;
        x = newStartX;
        doc.fontSize(10);
        ['S/N', 'Photo', 'Name', 'Cluster', 'Unit', 'Designations', 'Signature'].forEach((text, idx) => {
          const key = Object.keys(colWidths)[idx];
          doc.text(text, x, yPosition + 5, { width: colWidths[key], align: 'center' });
          x += colWidths[key];
        });
        yPosition += headerHeight;
        doc
          .moveTo(newStartX, yPosition)
          .lineTo(newStartX + totalTableWidth, yPosition)
          .strokeColor('#999')
          .lineWidth(0.5)
          .stroke();
      }
    });

    doc.end();
  } catch (error) {
    console.error('Error generating registration PDF:', error);
    res.status(500).send('Error generating PDF');
  }
});

// 11) PDF Export: Bulk ID Cards (A3, 25 per page)
app.get('/api/admin/export/idcards', async (req, res) => {
  try {
    const registrations = await Registration.find({}).lean();
    const doc = new PDFDocument({ size: 'A3', layout: 'portrait', margin: 20 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=idcards.pdf');
    doc.pipe(res);

    // Card dimensions: 5.9cm × 8.4cm ≈ 167 × 238 pt
    const cardWidth = 5.9 * 28.35;
    const cardHeight = 8.4 * 28.35;
    const columns = 5;
    const rows = 5;
    const cardsPerPage = columns * rows; // 25
    const margin = 20;
    const availableWidth = doc.page.width - margin * 2;
    const availableHeight = doc.page.height - margin * 2;
    const gutterX = (availableWidth - columns * cardWidth) / (columns + 1);
    const gutterY = (availableHeight - rows * cardHeight) / (rows + 1);

    // Helper to draw each ID card
    const drawIDCard = (doc, x, y, reg) => {
      doc.rect(x, y, cardWidth, cardHeight).fill('#B9D4AA');
      doc.fillColor('black');

      const headerPad = 0.1 * 28.35; // ≈ 2.8 pt
      const imageWidth = 1 * 28.35; // ≈ 28.35 pt

      // Load flag/logo from server‐side file system
      const flagPath = path.join(__dirname, 'public', 'flag.png');
      try {
        doc.image(flagPath, x + headerPad, y + headerPad, { width: imageWidth });
      } catch (err) {
        console.error('Error loading flag image:', err);
      }

      const logoPath = path.join(__dirname, 'public', 'logo.png');
      try {
        doc.image(logoPath, x + cardWidth - imageWidth - headerPad, y + headerPad, { width: imageWidth });
      } catch (err) {
        console.error('Error loading logo image:', err);
      }

      doc.font('Helvetica-Bold').fontSize(11).text('SKSSF', x, y + 32, { width: cardWidth, align: 'center' });
      doc.font('Helvetica').fontSize(8).text('Kadaba Zone', x, y + 45, { width: cardWidth, align: 'center' });
      doc.text('Annual Cabinet-Meet 2025', x, y + 60, { width: cardWidth, align: 'center' });

      // Photo rectangle and image
      const photoWidth = 2 * 28.35; // ≈ 57 pt
      const photoHeight = 2.5 * 28.35; // ≈ 71 pt
      const photoX = x + (cardWidth - photoWidth) / 2;
      const photoY = y + 70;
      doc.rect(photoX, photoY, photoWidth, photoHeight).lineWidth(1).stroke();
      if (reg.photoUrl) {
        try {
          const photoPath = path.join(__dirname, reg.photoUrl);
          doc.image(photoPath, photoX, photoY, { fit: [photoWidth, photoHeight] });
        } catch (err) {
          console.error('Error loading photo for', reg.name, err);
          doc
            .fontSize(8)
            .text('No Photo', photoX, photoY + photoHeight / 2 - 4, { width: photoWidth, align: 'center' });
        }
      } else {
        doc
          .fontSize(8)
          .text('No Photo', photoX, photoY + photoHeight / 2 - 4, { width: photoWidth, align: 'center' });
      }

      // Name, cluster‐unit, designations
      let detailY = photoY + photoHeight + 10;
      doc.font('Helvetica-Bold').fontSize(8).text(reg.name, x + 5, detailY, { width: cardWidth - 10, align: 'center' });
      detailY += 15;
      doc.font('Helvetica').text(`${reg.cluster} - ${reg.unit}`, x + 5, detailY, {
        width: cardWidth - 10,
        align: 'center',
      });
      detailY += 15;
      doc.text(reg.designations.join(', '), x + 5, detailY, { width: cardWidth - 10, align: 'center' });

      // Footer (date + “Mueenul Islam Madrasa Kadaba”)
      const footerHeight = 0.1 * 28.35 + 8 + 0.1 * 28.35; // ~14 pt
      doc.rect(x, y + cardHeight - footerHeight, cardWidth, footerHeight).fill('#5A827E');
      doc.fillColor('black').fontSize(8).font('Helvetica');
      doc.text('01-06-2025 Sunday', x, y + cardHeight - footerHeight + 3, {
        width: cardWidth,
        align: 'center',
      });
      doc.text('Mueenul Islam Madrasa Kadaba', x, y + cardHeight - footerHeight + 10, {
        width: cardWidth,
        align: 'center',
      });
    };

    let cardCount = 0;
    registrations.forEach((reg, index) => {
      const posIndex = cardCount % cardsPerPage;
      const colIndex = posIndex % columns;
      const rowIndex = Math.floor(posIndex / columns);
      const x = margin + gutterX + colIndex * (cardWidth + gutterX);
      const y = margin + gutterY + rowIndex * (cardHeight + gutterY);
      drawIDCard(doc, x, y, reg);
      cardCount++;

      if (cardCount % cardsPerPage === 0 && index < registrations.length - 1) {
        doc.addPage({ size: 'A3', layout: 'portrait', margin });
      }
    });

    doc.end();
  } catch (error) {
    console.error('Error generating ID cards PDF:', error);
    res.status(500).send('Error generating PDF');
  }
});

// 12) Test route
app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

// 13) Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
