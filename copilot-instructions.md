The main goal of this budget-tracker application is for end-users to be able to manage their finance, budgeting, projects, and contractors.

The application MUST meet the following hard requirements:
    - No backend server depedency, it must compile as a single page application that is 100% client-side
    - The ability to save and load a database file containing all information entered into the application and its settings
    - Responsive UI, and able to render on mobile phones and various screen sizes
    - The application will support a large amount of text-based data such as millions of transactions and links
    - The application database will support the ability to store multiple bank accounts (checking, savings, expense) and support the user being able to label them 
    - The application must prevent duplicate transactions from being uploaded either by letting the user select a key column in the CSV file, or by allowing the user to pick columns that will be hashed to verify unqiueness (which is automatically the account number, date, amount, and merchant info/description)


Features:
    - The application is a single page application (SPA)
    - The application is completely client side driven, no backend servers or server side-rendering
    - The application will be built off next.js framework, Material-UI components, and TypeScript
    - The application will support mobile devices and various screen sizes without rendering issues
    - The application uses wa-sqlite libraries for database management & storage with VFS backend to IndexedDB
    - The application will support the ability to import and map CSV files containing transactions
    - The application will encrypt and secure the database when exported to a file
    - The application will support the ability to add users with passwords stored in the database for which the user password can unlock or decrypt the database file
    - The application will have a logging system which can write debug logs and information to help troubleshoot and improve the application
    - The application will support the ability for users to edit and manage transactions, and apply labels and associate a transaction to a budget, house projects, and company
    - The application will support the ability to query all recorded transactions, and allow for users to filter on fields, and columns that display in the report
    - The application will support visualizations, graphs, and trends for which the user can filter on to understand their budget, recent transactions, and projects

    
Below is a raw CSV export of transaction data from Huntington bank, for which this application will support importing via CSV:

"Original Account Number","Account Number","Transaction Date","Posting Date","Billing Amount","Merchant","Merchant City","Merchant State","Merchant Zip","Reference Number","Debit/Credit Flag","MCC Code"
"...1682","...1682","06/22/2025","06/22/2025","-151.36","ONLINE PASSPORT FEES","CHARLESTON","SC","","05134375EHEVR2S4J","D",""
"...1682","...1682","06/22/2025","06/22/2025","-107.08","TST* P.O. BOX 21","WESTERVILLE","OH","","02305375DEJ1FKRK4","D",""
"...1682","...1682","06/22/2025","06/22/2025","-61.53","KROGER #965","WESTERVILLE","OH","","05436845D8PL9YZ32","D",""
"...1682","...1682","06/22/2025","06/22/2025","-56.09","MARATHON PETRO176602","WESTERVILLE","OH","","22303795D03M6DJ7M","D",""
"...1682","...1682","06/22/2025","06/22/2025","-9.62","AMAZON MARK* NQ9OX3LW2","SEATTLE","WA","","82305095DEHMLV24R","D",""
"...3517","...1682","06/21/2025","06/21/2025","-113.42","LULULEMONCOM*","877-263-9300","CA","","55432865Q6082JXED","D",""
"...1682","...1682","06/21/2025","06/21/2025","-98.44","TST*AMPERSAND ASIAN SU","WESTERVILLE","OH","","55432865D60JS00W6","D",""
"...1682","...1682","06/21/2025","06/21/2025","-43.2","TST*HIGH BANK DISTILLE","WESTERVILLE","OH","","55432865D60JVZ6F0","D",""
"...1682","...1682","06/21/2025","06/21/2025","-12.83","SPOTIFY P37E0840B7","NEW YORK","NY","","02703405Q2VJYVKRR","D",""
"...1682","...1682","06/21/2025","06/21/2025","-6","THE HOME DEPOT #3825","WESTERVILLE","OH","","52707155D09G3TZ5E","D",""
"...1682","...1682","06/20/2025","06/20/2025","3454.02","PYMT BY FUNDS TRANSFER","COLUMBUS","OH","","85269565D2W6DRMEL","C",""
"...3517","...1682","06/20/2025","06/20/2025","-178.6","GIANT EAGLE #6507","WESTERVILLE","OH","","02305375Q00KFD2Q3","D",""
"...3517","...1682","06/20/2025","06/20/2025","-91.21","TST* LAS MARGARITAS WE","WESTERVILLE","OH","","02305375B8PNFX76F","D",""
"...3517","...1682","06/20/2025","06/20/2025","-31.09","APPLE.COM/BILL","866-712-7753","CA","","55432865B5ZZXFJGV","D",""
"...1682","...1682","06/20/2025","06/20/2025","-26","RB - ERIC","WESTERVILLE","OH","","75454915BS66GAKLV","D",""
"...3517","...1682","06/20/2025","06/20/2025","-21.32","AMAZON.COM*NO2RR4F30","AMZN.COM/BILL","WA","","55432865B5ZWEHE5A","D",""
"...3517","...1682","06/20/2025","06/20/2025","-20.93","RED BANK FOOD AND BEVE","WESTERVILLE","OH","","55436875B8FMLM328","D",""
"...3517","...1682","06/19/2025","06/19/2025","-164.15","AMAZON MKTPL*NO2467OP1","AMZN.COM/BILL","WA","","55432865A5ZHD4M13","D",""
"...3517","...1682","06/19/2025","06/19/2025","-34.24","AMAZON MKTPL*NO5GX58L2","AMZN.COM/BILL","WA","","55432865A5ZJ8M3E5","D",""