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
    // Uncomment to enforce TLS 1.2+:
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
  photoUrl: { type: String }, // e.g. "uploads/filename.jpg"
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
      // Multer saved it under "uploads/…"
      photoUrl = req.file.path; // e.g. "uploads/photo-1629876543210.jpg"
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

// 10) PDF Export: Registrations table (A4) with proper pagination
app.get('/api/admin/export/registrations', async (req, res) => {
  try {
    const registrations = await Registration.find({}).lean();
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=registrations.pdf');
    doc.pipe(res);

    // -- Draw table header on each page --
    const drawTableHeader = () => {
      doc.fontSize(16).text('SKSSF Kadaba Zone', { align: 'center' });
      doc.fontSize(14).text('Annual Cabinet-Meet 2025', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text('Registration Data', { align: 'center' });
      doc.moveDown(0.5);

      const colWidths = {
        sn: 30,
        photo: 50,
        name: 90,
        cluster: 60,
        unit: 60,
        designations: 120,
        signature: 60,
      };
      const totalTableWidth = Object.values(colWidths).reduce((sum, w) => sum + w, 0);
      const startX = (doc.page.width - totalTableWidth) / 2;
      let yPosition = doc.y;

      // Top border line
      doc
        .save()
        .moveTo(startX, yPosition)
        .lineTo(startX + totalTableWidth, yPosition)
        .strokeColor('#999')
        .lineWidth(0.5)
        .stroke()
        .restore();

      // Header row (20pt tall)
      const headerHeight = 20;
      let x = startX;
      doc.fontSize(10).fillColor('black');
      ['S/N', 'Photo', 'Name', 'Cluster', 'Unit', 'Designations', 'Signature'].forEach((text, idx) => {
        const key = Object.keys(colWidths)[idx];
        doc.text(text, x, yPosition + 5, { width: colWidths[key], align: 'center' });
        x += colWidths[key];
      });

      // Bottom border under header
      const headerBottom = yPosition + headerHeight;
      doc
        .save()
        .moveTo(startX, headerBottom)
        .lineTo(startX + totalTableWidth, headerBottom)
        .strokeColor('#999')
        .lineWidth(0.5)
        .stroke()
        .restore();

      return { startX, yPosition: headerBottom };
    };

    // Draw first page header
    let { startX, yPosition } = drawTableHeader();
    const colWidths = {
      sn: 30,
      photo: 50,
      name: 90,
      cluster: 60,
      unit: 60,
      designations: 120,
      signature: 60,
    };
    const rowHeight = 60;
    let serialNo = 1;

    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i];

      // Paginate if needed
      if (yPosition + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 50 });
        const headerData = drawTableHeader();
        startX = headerData.startX;
        yPosition = headerData.yPosition;
      }

      let x = startX;

      // 1) S/N
      doc.fontSize(10).fillColor('black');
      doc.text(serialNo.toString(), x, yPosition + 10, {
        width: colWidths.sn,
        align: 'center',
      });
      serialNo++;
      x += colWidths.sn;

      // 2) Photo
      if (reg.photoUrl) {
        try {
          const imagePath = path.join(__dirname, reg.photoUrl);
          if (fs.existsSync(imagePath)) {
            doc.image(imagePath, x + 5, yPosition + 5, {
              fit: [colWidths.photo - 10, 50],
            });
          } else {
            doc
              .fontSize(8)
              .fillColor('gray')
              .text('N/A', x, yPosition + 20, {
                width: colWidths.photo,
                align: 'center',
              });
          }
        } catch {
          doc
            .fontSize(8)
            .fillColor('gray')
            .text('N/A', x, yPosition + 20, {
              width: colWidths.photo,
              align: 'center',
            });
        }
      } else {
        doc
          .fontSize(8)
          .fillColor('gray')
          .text('N/A', x, yPosition + 20, {
            width: colWidths.photo,
            align: 'center',
          });
      }
      x += colWidths.photo;

      // 3) Name
      doc.text(reg.name, x, yPosition + 10, {
        width: colWidths.name,
        align: 'left',
      });
      x += colWidths.name;

      // 4) Cluster
      doc.text(reg.cluster, x, yPosition + 10, {
        width: colWidths.cluster,
        align: 'left',
      });
      x += colWidths.cluster;

      // 5) Unit
      doc.text(reg.unit, x, yPosition + 10, {
        width: colWidths.unit,
        align: 'left',
      });
      x += colWidths.unit;

      // 6) Designations
      doc.text(reg.designations.join(', '), x, yPosition + 10, {
        width: colWidths.designations,
        align: 'left',
      });
      x += colWidths.designations;

      // 7) Signature (blank)
      doc.text('', x, yPosition + 10, {
        width: colWidths.signature,
        align: 'center',
      });

      // Bottom border under row
      doc
        .save()
        .moveTo(startX, yPosition + rowHeight)
        .lineTo(startX + Object.values(colWidths).reduce((s, w) => s + w, 0), yPosition + rowHeight)
        .strokeColor('#999')
        .lineWidth(0.5)
        .stroke()
        .restore();

      yPosition += rowHeight;
      doc.y = yPosition;
    }

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

    // Card dims at 300 DPI: 5.9cm × 8.4cm → ~696 × 992 px
    const cardWidth = (5.9 / 2.54) * 300;
    const cardHeight = (8.4 / 2.54) * 300;
    const columns = 5;
    const rows = 5;
    const cardsPerPage = columns * rows;
    const margin = 20;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    const gutterX = (availableWidth - columns * cardWidth) / (columns + 1);
    const gutterY = (availableHeight - rows * cardHeight) / (rows + 1);

    const drawIDCard = (doc, x, y, reg) => {
      doc.rect(x, y, cardWidth, cardHeight).fill('#ECFAE5');
      doc.fillColor('black');

      // Use high-res template if present
      const templatePath = path.join(__dirname, 'public', 'idcard-template.png');
      if (fs.existsSync(templatePath)) {
        try {
          doc.image(templatePath, x, y, { width: cardWidth, height: cardHeight });
        } catch (err) {
          console.error('Error loading ID card template:', err);
        }
      }

      const cmToPx300 = (cm) => Math.round(cm * (300 / 2.54));
      const PHOTO_DIAMETER_PX = cmToPx300(2.5);
      const PHOTO_TOP_PX = y + cmToPx300(1.9);
      const PHOTO_LEFT_PX = x + (cardWidth - PHOTO_DIAMETER_PX) / 2;

      if (reg.photoUrl) {
        const photoPath = path.join(__dirname, reg.photoUrl);
        if (fs.existsSync(photoPath)) {
          try {
            doc.image(photoPath, PHOTO_LEFT_PX, PHOTO_TOP_PX, {
              fit: [PHOTO_DIAMETER_PX, PHOTO_DIAMETER_PX],
            });
          } catch {
            doc
              .fontSize(cmToPx300(0.3))
              .fillColor('gray')
              .text(
                'No Photo',
                PHOTO_LEFT_PX,
                PHOTO_TOP_PX + PHOTO_DIAMETER_PX / 2 - cmToPx300(0.15),
                { width: PHOTO_DIAMETER_PX, align: 'center' }
              );
          }
        } else {
          doc
            .fontSize(cmToPx300(0.3))
            .fillColor('gray')
            .text(
              'No Photo',
              PHOTO_LEFT_PX,
              PHOTO_TOP_PX + PHOTO_DIAMETER_PX / 2 - cmToPx300(0.15),
              { width: PHOTO_DIAMETER_PX, align: 'center' }
            );
        }
      } else {
        doc
          .fontSize(cmToPx300(0.3))
          .fillColor('gray')
          .text(
            'No Photo',
            PHOTO_LEFT_PX,
            PHOTO_TOP_PX + PHOTO_DIAMETER_PX / 2 - cmToPx300(0.15),
            { width: PHOTO_DIAMETER_PX, align: 'center' }
          );
      }

      let detailY = PHOTO_TOP_PX + PHOTO_DIAMETER_PX + cmToPx300(0.2);
      doc
        .font('Helvetica-Bold')
        .fontSize(cmToPx300(0.35))
        .fillColor('#000')
        .text(reg.name, x + 5, detailY, {
          width: cardWidth - 10,
          align: 'center',
        });

      detailY += cmToPx300(1.2);
      doc
        .font('Helvetica')
        .fontSize(cmToPx300(0.28))
        .fillColor('#000')
        .text(`${reg.cluster} – ${reg.unit}`, x + 5, detailY, {
          width: cardWidth - 10,
          align: 'center',
        });

      detailY += cmToPx300(1.0);
      doc
        .font('Helvetica-Bold')
        .fontSize(cmToPx300(0.28))
        .fillColor('#000')
        .text(reg.designations.join(', '), x + 5, detailY, {
          width: cardWidth - 10,
          align: 'center',
        });
    };

    let cardCount = 0;
    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i];
      const posIndex = cardCount % cardsPerPage;
      const colIndex = posIndex % columns;
      const rowIndex = Math.floor(posIndex / columns);

      const x = margin + gutterX + colIndex * (cardWidth + gutterX);
      const y = margin + gutterY + rowIndex * (cardHeight + gutterY);

      drawIDCard(doc, x, y, reg);
      cardCount++;

      if (cardCount % cardsPerPage === 0 && i < registrations.length - 1) {
        doc.addPage({ size: 'A3', layout: 'portrait', margin: 20 });
      }
    }

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
