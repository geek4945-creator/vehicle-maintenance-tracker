// Shared sample data for tests (also used to build the sample workbook checked with openpyxl / LibreOffice).
module.exports = function fixture() {
  return {
    vehicles: [
      { id: 'v1', name: 'Truck 1', kind: 'Tow truck', year: 2019, make: 'Ford', model: 'F-550', vin: '1FDUF5HT0KDA00001', plate: 'ABC123', odometer: 85000, notes: 'Rollback', photo: null },
      { id: 'v2', name: 'Truck 2', kind: 'Tow truck', year: 2016, make: 'Ram', model: '5500', vin: '', plate: 'XYZ789', odometer: 140500, notes: '', photo: null },
      { id: 'v3', name: 'Personal Tesla', kind: 'Personal', year: 2022, make: 'Tesla', model: 'Model Y', vin: '', plate: 'TSL001', odometer: 12000, notes: '=cmd|"/c calc"!A1', photo: null }
    ],
    services: [
      { id: 's1', vehicleId: 'v1', date: '2026-01-10', type: 'Oil change', odometer: 80000, vendor: 'Jiffy', parts: 60, labor: 40, total: 100, notes: '', receipt: null },
      { id: 's2', vehicleId: 'v1', date: '2026-03-15', type: 'Brakes', odometer: 82500, vendor: 'Brake Shop', parts: 300.5, labor: 200.25, total: 520, notes: 'incl. $19.25 fees', receipt: 'data:image/jpeg;base64,AAAA' },
      { id: 's3', vehicleId: 'v1', date: '2026-08-20', type: 'Oil change', odometer: 85000, vendor: 'Jiffy', parts: 65, labor: 40, total: 105, notes: '', receipt: null },
      { id: 's4', vehicleId: 'v2', date: '2026-02-01', type: 'Tires', odometer: 140000, vendor: 'Les Schwab', parts: 1200, labor: 150, total: 1350, notes: 'Four drive tires, "heavy duty"', receipt: null },
      { id: 's5', vehicleId: 'v2', date: '2026-02-20', type: 'Repairs', odometer: null, vendor: 'Dave, the mechanic', parts: 0, labor: 0, total: 80, notes: '', receipt: null }
    ],
    expenses: [
      { id: 'e1', vehicleId: 'v1', date: '2026-01-15', category: 'Fuel', amount: 120.4, vendor: 'Costco', odometer: 80300, notes: '' },
      { id: 'e2', vehicleId: 'v1', date: '2026-03-02', category: 'Fuel', amount: 99.6, vendor: 'Costco', odometer: null, notes: '' },
      { id: 'e3', vehicleId: 'v2', date: '2026-02-05', category: 'Tolls', amount: 12.5, vendor: 'ODOT', odometer: null, notes: '' },
      { id: 'e4', vehicleId: null, date: '2026-02-28', category: 'Insurance', amount: 450, vendor: 'Progressive', odometer: null, notes: 'Business policy' },
      { id: 'e5', vehicleId: 'v3', date: '2026-09-01', category: 'Registration', amount: 316, vendor: 'DMV', odometer: null, notes: '' }
    ],
    reminders: [
      { id: 'r1', vehicleId: 'v1', type: 'Oil change', intervalMonths: 6, intervalMiles: 5000, baseDate: null, baseOdometer: null, dueDate: null, notes: '' },
      { id: 'r2', vehicleId: 'v2', type: 'Registration', intervalMonths: 12, intervalMiles: null, baseDate: null, baseOdometer: null, dueDate: '2026-10-31', notes: '' }
    ],
    settings: { businessName: "JD's Towing", soonDays: 30, soonMiles: 500 }
  };
};
