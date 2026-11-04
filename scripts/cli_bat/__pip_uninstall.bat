@ECHO OFF

rem  --------
     PAUSE
rem  --------

ECHO;
ECHO ---------
ECHO uninstall
ECHO ---------
python -m pip freeze     > requirements.txt
python -m pip uninstall -r requirements.txt -y

ECHO;
ECHO Waiting...5s
ping 127.0.0.1 -w 1000 -n 5 >nul

ECHO;
ECHO --------
ECHO upgrade
ECHO --------
python -m pip install --upgrade pip
pip install --upgrade wheel
pip install --upgrade setuptools

ECHO;
ECHO --------
ECHO pip list
ECHO --------
python -m pip  list

rem  --------
     PAUSE
rem  --------
